import * as THREE from "three";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";

/** Tamaño de tile en metros reales para repeat UV. */
export const TRACK_TILE_METERS = {
  road: 2,
  grass: 4,
  kerb: 1,
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
  kerb: {
    color: `${TEXTURE_ROOT}/kerb/Candy001_1K-JPG_Color.jpg`,
    normal: `${TEXTURE_ROOT}/kerb/Candy001_1K-JPG_NormalGL.jpg`,
    roughness: `${TEXTURE_ROOT}/kerb/Candy001_1K-JPG_Roughness.jpg`,
  },
} as const;

const SKY_HDRI_URL = `${TEXTURE_ROOT}/sky/DaySkyHDRI063B_2K_HDR.exr`;

/** Extensión del terreno de césped (m). Debe coincidir con `createGrassTerrainGeometry` en RaceScene. */
export const GROUND_PLANE_SIZE_METERS = 6000;

export interface TrackSurfaceMaterials {
  road: THREE.MeshStandardMaterial;
  grass: THREE.MeshStandardMaterial;
  kerb: THREE.MeshStandardMaterial;
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
    const [road, grass, kerb, sky] = await Promise.all([
      loadPbrSet("road", 8),
      loadPbrSet("grass", 4),
      loadPbrSet("kerb", 6),
      loadSkyTexture(),
    ]);

    skyTexture = sky;
    surfaceMaterials = {
      road: buildSurfaceMaterial(road, { roughness: 0.88, metalness: 0.03 }),
      grass: buildSurfaceMaterial(grass, { roughness: 0.95, metalness: 0 }),
      kerb: buildSurfaceMaterial(kerb, { roughness: 0.75, metalness: 0.04 }),
    };
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
  const environmentMap = pmrem.fromEquirectangular(skyTexture).texture;
  pmrem.dispose();

  scene.environment = environmentMap;
  scene.background = skyTexture;
  scene.backgroundBlurriness = 0.04;
  scene.backgroundIntensity = 1;

  const fogColor = new THREE.Color("#c5d4e4");
  scene.fog = new THREE.Fog(fogColor.getHex(), 400, 2400);
}
