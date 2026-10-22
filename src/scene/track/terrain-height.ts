import * as THREE from "three";
import { SpatialIndex, type BoundsXZ } from "./spatial";

interface TerrainTriangle extends BoundsXZ {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
}

export function createTerrainHeightSampler(geometry: THREE.BufferGeometry) {
  const positions = geometry.getAttribute("position");
  const indices = geometry.getIndex();
  const triangles: TerrainTriangle[] = [];
  if (indices) for (let i = 0; i < indices.count; i += 3) {
    const [a, b, c] = [0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(positions, indices.getX(i + j)));
    triangles.push({ a, b, c, minX: Math.min(a.x, b.x, c.x), maxX: Math.max(a.x, b.x, c.x),
      minZ: Math.min(a.z, b.z, c.z), maxZ: Math.max(a.z, b.z, c.z) });
  }
  const index = new SpatialIndex(triangles);
  return (x: number, z: number, fallback: number) => {
    for (const { a, b, c } of index.query({ minX: x - 0.001, maxX: x + 0.001, minZ: z - 0.001, maxZ: z + 0.001 })) {
      const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(denominator) < 1e-10) continue;
      const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / denominator;
      const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / denominator;
      if (u >= -0.001 && v >= -0.001 && u + v <= 1.001) return u * a.y + v * b.y + (1 - u - v) * c.y;
    }
    return fallback;
  };
}
