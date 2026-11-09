import * as THREE from "three";
import type { PitLane } from "./pit-lane";
import { crossSectionPoint } from "./ribbon";
import type { createTerrainHeightSampler } from "./terrain-height";

export function createPitApron(
  lane: PitLane, from: number, to: number, side: number, depth: number,
  terrainHeight: ReturnType<typeof createTerrainHeightSampler>, material: THREE.Material,
) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const columns = 4;
  const steps = Math.ceil((to - from) / 1.5);
  for (let row = 0; row <= steps; row++) {
    const distance = THREE.MathUtils.lerp(from, to, row / steps);
    const { index, fraction } = lane.path.segmentAt(distance);
    const edge = crossSectionPoint(lane.sections[index], side * lane.width / 2)
      .lerp(crossSectionPoint(lane.sections[index + 1], side * lane.width / 2), fraction);
    const lateral = lane.sections[index].lateral.clone().lerp(lane.sections[index + 1].lateral, fraction).normalize();
    for (let column = 0; column <= columns; column++) {
      const offset = THREE.MathUtils.lerp(-0.12, depth, column / columns);
      const point = edge.clone().addScaledVector(lateral, offset * side);
      const ground = terrainHeight(point.x, point.z, edge.y);
      const asphalt = lane.heightAt(point.x, point.z, NaN);
      point.y = Number.isFinite(asphalt) ? asphalt - 0.018 : ground + 0.036;
      positions.push(point.x, point.y, point.z);
      uvs.push(offset / 2, distance / 2);
      if (row === 0 || column === columns) continue;
      const a = (row - 1) * (columns + 1) + column;
      const b = row * (columns + 1) + column;
      if (side > 0) indices.push(a, a + 1, b, b, a + 1, b + 1);
      else indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "pit-garage-apron";
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  return mesh;
}
