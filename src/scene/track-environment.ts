import * as THREE from "three";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import type { GraphicsSettings } from "./graphics-settings";

export const TRACK_TILE_METERS = {
  road: 3,
  grass: 6,
  kerb: 2.4,
} as const;

const TEXTURE_ROOT = "/textures";

const PBR_SETS = {
  road: {
    color: `${TEXTURE_ROOT}/road/Road012A_2K-JPG_Color.jpg`,
    normal: `${TEXTURE_ROOT}/road/Road012A_2K-JPG_NormalGL.jpg`,
    roughness: `${TEXTURE_ROOT}/road/Road012A_2K-JPG_Roughness.jpg`,
    ao: `${TEXTURE_ROOT}/road/Road012A_2K-JPG_AmbientOcclusion.jpg`,
  },
  grass: {
    color: `${TEXTURE_ROOT}/grass/Grass005_2K-JPG_Color.jpg`,
    normal: `${TEXTURE_ROOT}/grass/Grass005_2K-JPG_NormalGL.jpg`,
    roughness: `${TEXTURE_ROOT}/grass/Grass005_2K-JPG_Roughness.jpg`,
    ao: `${TEXTURE_ROOT}/grass/Grass005_2K-JPG_AmbientOcclusion.jpg`,
  },
  gravel: {
    color: `${TEXTURE_ROOT}/gravel/Gravel023_1K-JPG_Color.jpg`,
    normal: `${TEXTURE_ROOT}/gravel/Gravel023_1K-JPG_NormalGL.jpg`,
    roughness: `${TEXTURE_ROOT}/gravel/Gravel023_1K-JPG_Roughness.jpg`,
    ao: `${TEXTURE_ROOT}/gravel/Gravel023_1K-JPG_AmbientOcclusion.jpg`,
  },
} as const;

const SKY_HDRI_URL = `${TEXTURE_ROOT}/sky/DaySkyHDRI063B_2K_HDR.exr`;

export const GROUND_PLANE_SIZE_METERS = 2200;
export const TRACK_GROUND_PADDING_METERS = 320;
export const HORIZON_CLEARANCE_METERS = 90;

export interface TrackSurfaceMaterials {
  road: THREE.MeshStandardMaterial;
  grass: THREE.MeshStandardMaterial;
  kerb: THREE.MeshStandardMaterial;
  gravel: THREE.MeshStandardMaterial;
  apron: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
}

interface PbrTextureSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  aoMap?: THREE.Texture;
}

let loadPromise: Promise<void> | null = null;
let skyTexture: THREE.DataTexture | null = null;
let surfaceMaterials: TrackSurfaceMaterials | null = null;
let skyTarget: THREE.WebGLRenderTarget | null = null;
const detailMaps = new Map<THREE.MeshStandardMaterial, Pick<PbrTextureSet, "normalMap" | "roughnessMap" | "aoMap">>();
const clearSkies = new Map<string, THREE.CanvasTexture>();

function clearSky(style: GraphicsSettings["lighting"]) {
  const existing = clearSkies.get(style);
  if (existing) return existing;
  const canvas = document.createElement("canvas");
  canvas.width = 64; canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, style === "warm" ? "#7398b9" : style === "overcast" ? "#9fadb7" : "#548fbd");
  gradient.addColorStop(0.42, style === "warm" ? "#ccd2cc" : "#b5cfdc");
  gradient.addColorStop(0.5, style === "warm" ? "#e1d3ba" : "#d4dfe0");
  gradient.addColorStop(0.53, "#b4bba8");
  gradient.addColorStop(1, "#7d8774");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  clearSkies.set(style, texture);
  return texture;
}

function tuneSurface(material: THREE.MeshStandardMaterial, saturation: number, roughnessFloor: number) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>",
      `#include <color_fragment>\nfloat surfaceLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));\ndiffuseColor.rgb = mix(vec3(surfaceLuma), diffuseColor.rgb, ${saturation.toFixed(2)});`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\nroughnessFactor = max(roughnessFactor, ${roughnessFloor.toFixed(2)});`);
  };
  material.customProgramCacheKey = () => `surface-${saturation}-${roughnessFloor}`;
}

function createKerbMaterial() {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#e2ded4";
  context.fillRect(0, 0, 32, 128);
  context.fillStyle = "#b52927";
  context.fillRect(0, 0, 32, 64);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return new THREE.MeshStandardMaterial({ map, roughness: 0.87, metalness: 0 });
}

function loadColorTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        resolve(texture);
      },
      undefined,
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

function loadLinearTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (texture) => {
        texture.colorSpace = THREE.NoColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        resolve(texture);
      },
      undefined,
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

function configureTextureQuality(texture: THREE.Texture, anisotropy: number, repeat?: THREE.Vector2) {
  texture.anisotropy = anisotropy;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  if (repeat) {
    texture.repeat.copy(repeat);
  }
  texture.needsUpdate = true;
}

async function loadPbrSet(
  key: keyof typeof PBR_SETS,
  anisotropy: number,
  repeat?: THREE.Vector2,
): Promise<PbrTextureSet> {
  const paths = PBR_SETS[key];
  const [map, normalMap, roughnessMap, aoMap] = await Promise.all([
    loadColorTexture(paths.color),
    loadLinearTexture(paths.normal),
    loadLinearTexture(paths.roughness),
    "ao" in paths ? loadLinearTexture(paths.ao) : Promise.resolve(undefined),
  ]);

  configureTextureQuality(map, anisotropy, repeat);
  configureTextureQuality(normalMap, anisotropy, repeat);
  configureTextureQuality(roughnessMap, anisotropy, repeat);
  if (aoMap) {
    configureTextureQuality(aoMap, anisotropy, repeat);
  }

  return { map, normalMap, roughnessMap, aoMap };
}

function buildSurfaceMaterial(textures: PbrTextureSet, overrides: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({
    map: textures.map,
    normalMap: textures.normalMap,
    roughnessMap: textures.roughnessMap,
    aoMap: textures.aoMap,
    aoMapIntensity: textures.aoMap ? 0.85 : 0,
    metalness: 0.02,
    roughness: 0.92,
    ...overrides,
  });
}

function loadSkyTexture(): Promise<THREE.DataTexture> {
  return new Promise((resolve, reject) => {
    new EXRLoader().load(
      SKY_HDRI_URL,
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        resolve(texture);
      },
      undefined,
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

export function preloadTrackEnvironment(): Promise<void> {
  if (surfaceMaterials) {
    return Promise.resolve();
  }
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    const [road, grass, gravel, sky] = await Promise.all([
      loadPbrSet("road", 8),
      loadPbrSet("grass", 4),
      loadPbrSet("gravel", 4),
      loadSkyTexture(),
    ]);

    skyTexture = sky;
    surfaceMaterials = {
      road: buildSurfaceMaterial(road, { color: "#a9afb2", roughness: 1, metalness: 0, envMapIntensity: 0.12, normalScale: new THREE.Vector2(0.035, 0.035) }),
      grass: buildSurfaceMaterial(grass, { color: "#b6b9a0", roughness: 1, metalness: 0, vertexColors: true, normalScale: new THREE.Vector2(0.45, 0.45) }),
      kerb: createKerbMaterial(),
      gravel: buildSurfaceMaterial(gravel, { color: "#c5b89b", roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.6, 0.6) }),
      apron: new THREE.MeshStandardMaterial({ color: "#477d70", roughness: 0.96 }),
      white: new THREE.MeshStandardMaterial({ color: "#e5e3d8", roughness: 0.85 }),
      rubber: new THREE.MeshStandardMaterial({ color: "#14181b", transparent: true, opacity: 0.13, depthWrite: false, roughness: 1 }),
      steel: new THREE.MeshStandardMaterial({ color: "#a0a8ab", roughness: 0.7, metalness: 0.55 }),
      concrete: new THREE.MeshStandardMaterial({ color: "#b9b6ac", roughness: 0.95 }),
    };
    for (const material of Object.values(surfaceMaterials)) {
      if (material.normalMap && material.roughnessMap) detailMaps.set(material, {
        normalMap: material.normalMap, roughnessMap: material.roughnessMap, aoMap: material.aoMap ?? undefined,
      });
    }
    tuneSurface(surfaceMaterials.road, 0.6, 0.87);
    tuneSurface(surfaceMaterials.grass, 0.55, 0.93);
    tuneSurface(surfaceMaterials.gravel, 0.75, 0.9);
  })().catch((error) => {
    loadPromise = null;
    throw error;
  });

  return loadPromise;
}

export function getTrackSurfaceMaterials(): TrackSurfaceMaterials {
  if (!surfaceMaterials) {
    throw new Error("Entorno de pista no precargado. Llama a preloadTrackEnvironment() antes.");
  }
  return surfaceMaterials;
}

export function applyTrackEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
  if (!skyTexture) {
    throw new Error("HDRI no precargado. Llama a preloadTrackEnvironment() antes.");
  }

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  skyTarget?.dispose();
  skyTarget = pmrem.fromEquirectangular(skyTexture);
  const environmentMap = skyTarget.texture;
  pmrem.dispose();

  scene.environment = environmentMap;
  scene.background = skyTexture;
  scene.backgroundBlurriness = 0.025;
  scene.backgroundIntensity = 0.8;

  const fogColor = new THREE.Color("#c8d3d6");
  scene.fog = new THREE.Fog(fogColor.getHex(), 800, 3200);
}

export function applySurfaceQuality(settings: GraphicsSettings, renderer: THREE.WebGLRenderer) {
  const anisotropy = Math.min(settings.anisotropy, renderer.capabilities.getMaxAnisotropy());
  for (const [material, maps] of detailMaps) {
    const normal = settings.surfaceDetail ? maps.normalMap : null;
    if (material.normalMap !== normal) {
      material.normalMap = normal;
      material.roughnessMap = settings.surfaceDetail ? maps.roughnessMap : null;
      material.aoMap = settings.surfaceDetail ? maps.aoMap ?? null : null;
      material.needsUpdate = true;
    }
  }
  for (const material of Object.values(getTrackSurfaceMaterials())) {
    const maps = detailMaps.get(material);
    for (const texture of [material.map, maps?.normalMap, maps?.roughnessMap, maps?.aoMap]) {
      if (texture && texture.anisotropy !== anisotropy) {
        texture.anisotropy = anisotropy;
        texture.needsUpdate = true;
      }
    }
  }
}

export function applySkyQuality(scene: THREE.Scene, settings: GraphicsSettings, color: string) {
  scene.background = settings.sky ? settings.skyStyle === "hdri" ? skyTexture : clearSky(settings.lighting) : new THREE.Color(color);
  scene.backgroundIntensity = settings.skyStyle === "hdri" ? 0.9 : 1;
  scene.environmentIntensity = settings.environmentIntensity;
}
