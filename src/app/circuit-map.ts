import type { TrackPoint3D } from "../types";

export function projectCircuit(points: TrackPoint3D[], width = 280, height = 260) {
  const finite = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.z));
  if (finite.length < 2) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of finite) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  const scale = Math.min((width - 36) / Math.max(1, maxX - minX), (height - 36) / Math.max(1, maxZ - minZ));
  const project = (x: number, z: number) => ({
    x: width / 2 + (x - (minX + maxX) / 2) * scale,
    y: height / 2 - (z - (minZ + maxZ) / 2) * scale,
  });
  const path = finite.map((point, index) => {
    const projected = project(point.x, point.z);
    return `${index ? "L" : "M"}${projected.x.toFixed(1)},${projected.y.toFixed(1)}`;
  }).join(" ");
  return { project, path };
}
