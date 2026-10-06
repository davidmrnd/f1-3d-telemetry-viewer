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

/** Longitud del mesh GLTF normalizado en preload (escala final = metros reales en escena). */
export const CAR_TEMPLATE_LENGTH = 0.32;

/** Yaw del mesh Blender respecto al eje de avance de la telemetría. */
export const CAR_MODEL_YAW_OFFSET = Math.PI / 2;

export function carHeadingToRotationY(heading: number): number {
  return CAR_MODEL_YAW_OFFSET - heading;
}

let preparedTemplate: THREE.Group | null = null;
let loadPromise: Promise<void> | null = null;
const liveryBodyTextures = new Map<string, THREE.Texture>();

export interface CarVisualParts {
  /** Anclaje en el mundo (telemetría); el mesh va en `model`. */
  group: THREE.Group;
  model: THREE.Group;
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
        cloned.roughness = Math.min(cloned.roughness, 0.55);
        cloned.metalness = Math.max(cloned.metalness, 0.35);
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
        liveryBodyTextures.set(url, texture);
        resolve(texture);
      },
      undefined,
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

export function preloadCarModels(): Promise<void> {
  if (preparedTemplate) {
    return Promise.resolve();
  }
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = loadCarsManifest().then(() => {
    const loader = new GLTFLoader();
    return new Promise<void>((resolve, reject) => {
      loader.load(
        getCarsManifest().mesh,
        (gltf) => {
          preparedTemplate = prepareTemplate(gltf.scene);
          preparedTemplate.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          Promise.all(getLiveryTextureUrls().map(loadLiveryBodyTexture))
            .then(() => resolve())
            .catch(reject);
        },
        undefined,
        (error) => {
          loadPromise = null;
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  });

  return loadPromise;
}

export function createCarVisual(driver: DriverInfo, sceneLength = CAR_TEMPLATE_LENGTH): CarVisualParts {
  if (!preparedTemplate) {
    throw new Error("Modelos de coche no precargados. Llama a preloadCarModels() antes.");
  }

  const livery = resolveCarLivery(driver);
  const bodyTexture = liveryBodyTextures.get(livery.body);
  if (!bodyTexture) {
    throw new Error(`Textura de livery no precargada: ${livery.body}`);
  }

  const lengthScale = sceneLength / CAR_TEMPLATE_LENGTH;
  const anchor = new THREE.Group();
  anchor.rotation.order = "YXZ";
  const model = preparedTemplate.clone(true);
  model.scale.multiplyScalar(lengthScale);
  const carHeight = alignCarToGround(model);
  applyTeamTint(model, driver.teamColor);
  applyLiveryBody(model, bodyTexture);

  const label = createLabelSprite(driver.acronym, driver.teamColor);
  label.position.set(0, carHeight + 0.15, 0);
  label.scale.multiplyScalar(lengthScale);
  label.visible = false;
  model.add(label);
  anchor.add(model);

  return { group: anchor, model, label };
}

type MaterialBaseline = {
  metalness: number;
  roughness: number;
  envMapIntensity: number;
};

function ensureMaterialBaseline(material: THREE.MeshStandardMaterial): MaterialBaseline {
  const existing = material.userData.graphicsBaseline as MaterialBaseline | undefined;
  if (existing) {
    return existing;
  }
  const baseline: MaterialBaseline = {
    metalness: material.metalness,
    roughness: material.roughness,
    envMapIntensity: material.envMapIntensity,
  };
  material.userData.graphicsBaseline = baseline;
  return baseline;
}

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

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) {
        continue;
      }
      const baseline = ensureMaterialBaseline(material);
      if (options.materials === "simple") {
        material.metalness = 0;
        material.roughness = 1;
        material.envMapIntensity = 0;
      } else {
        material.metalness = baseline.metalness;
        material.roughness = baseline.roughness;
        material.envMapIntensity = baseline.envMapIntensity;
      }
      material.needsUpdate = true;
    }
  });
}

