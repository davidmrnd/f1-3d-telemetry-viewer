import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  getCarsManifest,
  getLiveryTextureUrls,
  LIVERY_BODY_TEXTURE_NAME,
  loadCarsManifest,
  resolveCarLivery,
} from "./car-livery";
import type { DriverInfo } from "../types";

export const CAR_TEMPLATE_LENGTH = 0.32;
export const CAR_MODEL_YAW_OFFSET = Math.PI / 2;
export const DETAILED_CAR_MAX_TEXTURE_SIZE = 1024;

export const LOWPOLY_CAR_MESH_URL = "/models/cars/f1lowpoly/lowpolyf1.glb";
export const LOWPOLY_CAR_SCALE = 0.90;

export type CarMeshStyle = "detailed" | "lowpoly";

export function carHeadingToRotationY(heading: number): number {
  return CAR_MODEL_YAW_OFFSET - heading;
}

let preparedTemplate: THREE.Group | null = null;
let preparedLowPolyTemplate: THREE.Group | null = null;
let loadPromise: Promise<void> | null = null;
const liveryBodyTextures = new Map<string, THREE.Texture>();

export interface CarVisualParts {
  group: THREE.Group;
  model: THREE.Group;
  detailed: THREE.Group;
  lowpoly: THREE.Group;
  label: THREE.Sprite;
}

function createLabelSprite(text: string, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("No se pudo crear el contexto del label.");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(8, 14, 24, 0.74)";
  context.strokeStyle = color;
  context.lineWidth = 4;
  context.beginPath();
  context.roundRect(6, 6, 180, 52, 18);
  context.fill();
  context.stroke();

  context.fillStyle = "#f7f9fc";
  context.font = "700 28px Bahnschrift";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 96, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    depthWrite: false,
    depthTest: false,
    sizeAttenuation: true,
    transparent: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.34, 0.12, 1);
  return sprite;
}

function cloneMaterial(material: THREE.Material): THREE.Material {
  return material.clone();
}

function applyTeamTint(root: THREE.Object3D, color: string) {
  const team = new THREE.Color(color);
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const tinted = materials.map((material) => {
      const cloned = cloneMaterial(material);
      if (cloned instanceof THREE.MeshStandardMaterial) {
        cloned.color.lerp(team, 0.14);
        cloned.emissive.set("#000000");
        cloned.emissiveIntensity = 0;
        const body = cloned.map?.name === LIVERY_BODY_TEXTURE_NAME;
        cloned.roughness = body ? 0.4 : Math.max(cloned.roughness, 0.8);
        cloned.metalness = body ? 0.15 : 0;
      }
      return cloned;
    });
    child.material = tinted.length === 1 ? tinted[0] : tinted;
  });
}

function applyLiveryBody(root: THREE.Object3D, bodyTexture: THREE.Texture) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (
        material instanceof THREE.MeshStandardMaterial &&
        material.map?.name === LIVERY_BODY_TEXTURE_NAME
      ) {
        material.map = bodyTexture;
        material.needsUpdate = true;
      }
    }
  });
}

function materialSlotName(material: THREE.Material): string {
  return material.name.replace(/\s+/g, "_");
}

function applyLowPolyTeamColors(root: THREE.Object3D, teamColor: string) {
  const primary = new THREE.Color(teamColor);
  const secondary = primary.clone().lerp(new THREE.Color("#ffffff"), 0.32);
  const accent = primary.clone().lerp(new THREE.Color("#111111"), 0.4);

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const painted = materials.map((material) => {
      const cloned = cloneMaterial(material);
      if (!(cloned instanceof THREE.MeshStandardMaterial)) {
        return cloned;
      }
      const slot = materialSlotName(cloned);
      if (slot === "BaseColor") {
        cloned.color.copy(primary);
      } else if (slot === "2ndColor") {
        cloned.color.copy(secondary);
      } else if (slot === "3rdColor") {
        cloned.color.copy(accent);
      }
      cloned.emissive.set("#000000");
      cloned.emissiveIntensity = 0;
      return cloned;
    });
    child.material = painted.length === 1 ? painted[0] : painted;
  });
}

function finalizeTemplate(source: THREE.Group): THREE.Group {
  const template = prepareTemplate(source);
  template.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return template;
}

function loadGltfScene(url: string): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(gltf.scene),
      undefined,
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

function prepareTemplate(source: THREE.Group): THREE.Group {
  const wrapper = new THREE.Group();
  wrapper.add(source);

  const bounds = new THREE.Box3().setFromObject(source);
  const size = bounds.getSize(new THREE.Vector3());
  const length = Math.max(size.x, size.y, size.z, 0.001);
  wrapper.scale.setScalar(CAR_TEMPLATE_LENGTH / length);

  return wrapper;
}

function alignCarToGround(group: THREE.Group) {
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  const center = bounds.getCenter(new THREE.Vector3());
  group.position.set(-center.x, -bounds.min.y, -center.z);
  return bounds.max.y - bounds.min.y;
}

function downscaleTexture(texture: THREE.Texture, maxSize: number) {
  const image = texture.image as
    | HTMLImageElement
    | HTMLCanvasElement
    | ImageBitmap
    | OffscreenCanvas
    | undefined;
  if (!image || !("width" in image) || !image.width || !image.height) {
    return;
  }
  const maxDim = Math.max(image.width, image.height);
  if (maxDim <= maxSize) {
    return;
  }
  const scale = maxSize / maxDim;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  context.drawImage(image as CanvasImageSource, 0, 0, width, height);
  texture.image = canvas;
  texture.needsUpdate = true;
}

function limitObjectTextures(root: THREE.Object3D, maxSize: number) {
  const seen = new Set<THREE.Texture>();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial) || !material.map) {
        continue;
      }
      if (seen.has(material.map)) {
        continue;
      }
      seen.add(material.map);
      downscaleTexture(material.map, maxSize);
    }
  });
}

function loadLiveryBodyTexture(url: string): Promise<THREE.Texture> {
  const cached = liveryBodyTextures.get(url);
  if (cached) {
    return Promise.resolve(cached);
  }

  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.name = LIVERY_BODY_TEXTURE_NAME;
        downscaleTexture(texture, DETAILED_CAR_MAX_TEXTURE_SIZE);
        liveryBodyTextures.set(url, texture);
        resolve(texture);
      },
      undefined,
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

export function preloadCarModels(): Promise<void> {
  if (preparedTemplate && preparedLowPolyTemplate) {
    return Promise.resolve();
  }
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = loadCarsManifest()
    .then(async () => {
      const [detailedScene, lowPolyScene] = await Promise.all([
        loadGltfScene(getCarsManifest().mesh),
        loadGltfScene(LOWPOLY_CAR_MESH_URL),
      ]);
      limitObjectTextures(detailedScene, DETAILED_CAR_MAX_TEXTURE_SIZE);
      await Promise.all(getLiveryTextureUrls().map(loadLiveryBodyTexture));
      preparedTemplate = finalizeTemplate(detailedScene);
      preparedLowPolyTemplate = finalizeTemplate(lowPolyScene);
    })
    .catch((error) => {
      loadPromise = null;
      throw error instanceof Error ? error : new Error(String(error));
    });

  return loadPromise;
}

function buildStyledCarModel(
  driver: DriverInfo,
  sceneLength: number,
  style: CarMeshStyle,
): { model: THREE.Group; height: number } {
  const template = style === "lowpoly" ? preparedLowPolyTemplate : preparedTemplate;
  if (!template) {
    throw new Error("Modelos de coche no precargados. Llama a preloadCarModels() antes.");
  }

  const lengthScale = sceneLength / CAR_TEMPLATE_LENGTH;
  const model = template.clone(true);
  model.scale.multiplyScalar(style === "lowpoly" ? lengthScale * LOWPOLY_CAR_SCALE : lengthScale);
  const height = alignCarToGround(model);

  if (style === "lowpoly") {
    applyLowPolyTeamColors(model, driver.teamColor);
  } else {
    const livery = resolveCarLivery(driver);
    const bodyTexture = liveryBodyTextures.get(livery.body);
    if (!bodyTexture) {
      throw new Error(`Textura de livery no precargada: ${livery.body}`);
    }
    applyTeamTint(model, driver.teamColor);
    applyLiveryBody(model, bodyTexture);
  }

  return { model, height };
}

export function createLowPolyCarModel(
  driver: DriverInfo,
  sceneLength = CAR_TEMPLATE_LENGTH,
): { model: THREE.Group; height: number } {
  return buildStyledCarModel(driver, sceneLength, "lowpoly");
}

export function createCarVisual(
  driver: DriverInfo,
  sceneLength = CAR_TEMPLATE_LENGTH,
): CarVisualParts {
  const lengthScale = sceneLength / CAR_TEMPLATE_LENGTH;
  const anchor = new THREE.Group();
  anchor.rotation.order = "YXZ";

  const detailed = buildStyledCarModel(driver, sceneLength, "detailed");
  const lowpoly = buildStyledCarModel(driver, sceneLength, "lowpoly");
  const carHeight = Math.max(detailed.height, lowpoly.height);

  const label = createLabelSprite(driver.acronym, driver.teamColor);
  label.position.set(0, carHeight + 0.15, 0);
  label.scale.multiplyScalar(lengthScale);
  label.visible = false;

  detailed.model.visible = true;
  lowpoly.model.visible = false;
  anchor.add(detailed.model, lowpoly.model, label);

  return {
    group: anchor,
    model: detailed.model,
    detailed: detailed.model,
    lowpoly: lowpoly.model,
    label,
  };
}

type MaterialVariants = { detailed: THREE.Material[]; simple: THREE.Material[] };

export function applyCarVisualQuality(
  root: THREE.Object3D,
  options: { materials: "pbr" | "simple"; castShadows: boolean },
) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || child instanceof THREE.Sprite) {
      return;
    }
    child.castShadow = options.castShadows;
    child.receiveShadow = options.castShadows;

    let variants = child.userData.graphicsVariants as MaterialVariants | undefined;
    if (!variants) {
      const detailed = Array.isArray(child.material) ? child.material : [child.material];
      variants = { detailed, simple: detailed.map((material) => {
        if (!(material instanceof THREE.MeshStandardMaterial)) return material;
        return new THREE.MeshLambertMaterial({ color: material.color, map: material.map,
          transparent: material.transparent, opacity: material.opacity, alphaTest: material.alphaTest,
          side: material.side, vertexColors: material.vertexColors, depthWrite: material.depthWrite });
      }) };
      child.userData.graphicsVariants = variants;
    }
    const selected = options.materials === "simple" ? variants.simple : variants.detailed;
    child.material = selected.length === 1 ? selected[0] : selected;
  });
}

export function disposeCarVisual(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  root.traverse((child) => {
    if (child instanceof THREE.Sprite) {
      child.material.map?.dispose();
      materials.add(child.material);
    } else if (child instanceof THREE.Mesh) {
      const variants = child.userData.graphicsVariants as MaterialVariants | undefined;
      const values = variants ? [...variants.detailed, ...variants.simple]
        : Array.isArray(child.material) ? child.material : [child.material];
      values.forEach((material) => materials.add(material));
    }
  });
  materials.forEach((material) => material.dispose());
}

