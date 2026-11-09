import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const MODEL_FILES = {
  garage: "pitsGarage",
  office: "pitsOffice",
  stand: "grandStandCovered",
  tree: "treeLarge",
  lamp: "lightPostModern",
  barrier: "barrierWhite",
} as const;

export type TrackModel = keyof typeof MODEL_FILES;

export interface TrackModelPlacement {
  position: THREE.Vector3;
  facing: THREE.Vector3;
  size: THREE.Vector3;
  tint?: THREE.Color;
}

const geometries = new Map<TrackModel, THREE.BufferGeometry>();
const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
let preload: Promise<void> | undefined;

function prepareGeometry(scene: THREE.Object3D): THREE.BufferGeometry | null {
  scene.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshStandardMaterial)) return;
    const source = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    source.applyMatrix4(object.matrixWorld);
    for (const attribute of Object.keys(source.attributes)) {
      if (attribute !== "position" && attribute !== "normal") source.deleteAttribute(attribute);
    }
    if (!source.hasAttribute("normal")) source.computeVertexNormals();
    const color = object.material.map ? new THREE.Color("#263843") : object.material.color;
    const colors = new Float32Array(source.getAttribute("position").count * 3);
    for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
    source.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    parts.push(source);
  });
  if (!parts.length) return null;
  const geometry = mergeGeometries(parts);
  parts.forEach((part) => part.dispose());
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  geometry.translate(-center.x, -bounds.min.y, -center.z);
  geometry.scale(1 / size.x, 1 / size.y, 1 / size.z);
  geometry.computeBoundingSphere();
  return geometry;
}

export function preloadTrackModels(): Promise<void> {
  if (preload) return preload;
  const loader = new GLTFLoader();
  preload = Promise.all(Object.entries(MODEL_FILES).map(async ([key, file]) => {
    try {
      const { scene } = await loader.loadAsync(`${import.meta.env.BASE_URL}models/track/kenney-racing/${file}.glb`);
      const geometry = prepareGeometry(scene);
      if (geometry) geometries.set(key as TrackModel, geometry);
      const sourceGeometries = new Set<THREE.BufferGeometry>();
      const sourceMaterials = new Set<THREE.MeshStandardMaterial>();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          sourceGeometries.add(object.geometry);
          if (object.material instanceof THREE.MeshStandardMaterial) sourceMaterials.add(object.material);
        }
      });
      sourceGeometries.forEach((source) => source.dispose());
      sourceMaterials.forEach((source) => {
        source.map?.dispose();
        source.dispose();
      });
    } catch (error) {
      console.warn(`No se pudo cargar el modelo de circuito ${file}.`, error);
    }
  })).then(() => undefined);
  return preload;
}

export function instanceTrackModel(model: TrackModel, placements: TrackModelPlacement[]): THREE.InstancedMesh | null {
  const geometry = geometries.get(model);
  if (!geometry || !placements.length) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  mesh.name = `kenney-${model}`;
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  placements.forEach(({ position, facing, size, tint }, i) => {
    rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(facing.x, facing.z));
    mesh.setMatrixAt(i, matrix.compose(position, rotation, size));
    if (tint) mesh.setColorAt(i, tint);
  });
  mesh.computeBoundingSphere();
  return mesh;
}
