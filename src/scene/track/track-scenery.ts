import * as THREE from "three";
import { segmentProjection, type PathSegment } from "./path";
import type { PitLane } from "./pit-lane";
import type { SpatialIndex } from "./spatial";
import type { createTerrainHeightSampler } from "./terrain-height";

function createFacadeTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const [offset, rows] of [[0, 3], [128, 8]]) {
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < 6; column++) {
        const x = offset + 8 + column * 19;
        const y = 6 + row * 102 / rows;
        context.fillStyle = (column + row * 3) % 5 === 0 ? "#8d969a" : "#53616b";
        context.fillRect(x, y, 12, 64 / rows);
        context.fillStyle = "#a1a7a7";
        context.fillRect(x, y + 64 / rows, 12, 1);
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createTrackScenery(
  points: THREE.Vector3[], track: SpatialIndex<PathSegment>, heightAt: ReturnType<typeof createTerrainHeightSampler>,
  urban: boolean, pitLane: PitLane | null,
) {
  const bounds = new THREE.Box3().setFromPoints(points);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const spacing = Math.max(urban ? 76 : 84, Math.max(size.x, size.z) / 20);
  const reach = urban ? 270 : 330;
  const positions: number[] = [], colors: number[] = [], uvs: number[] = [], indices: number[] = [];
  const box = new THREE.BoxGeometry(1, 1, 1);
  const canopy = new THREE.IcosahedronGeometry(1, 0);
  const conifer = new THREE.ConeGeometry(1, 1, 6);
  const treeColors = ["#4b6341", "#61754c", "#4e6855", "#687552"].map((value) => new THREE.Color(value));
  const wallColors = ["#a7a49b", "#bbb09b", "#9caaa9", "#a8937f"].map((value) => new THREE.Color(value));
  const roofColor = new THREE.Color("#66696a");
  const trunkColor = new THREE.Color("#635b49");
  let seed = 57383;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const addShape = (
    shape: THREE.BufferGeometry, x: number, y: number, z: number,
    width: number, height: number, depth: number, color: THREE.Color, facade?: number,
  ) => {
    const position = shape.getAttribute("position");
    const normal = shape.getAttribute("normal");
    const uv = shape.getAttribute("uv");
    const index = shape.getIndex();
    const base = positions.length / 3;
    for (let i = 0; i < position.count; i++) {
      positions.push(x + position.getX(i) * width, y + position.getY(i) * height, z + position.getZ(i) * depth);
      const shade = 0.82 + normal.getY(i) * 0.17 + normal.getX(i) * 0.08 - normal.getZ(i) * 0.06;
      colors.push(color.r * shade, color.g * shade, color.b * shade);
      if (facade !== undefined && Math.abs(normal.getY(i)) < 0.5) {
        uvs.push((facade * 128 + 1 + uv.getX(i) * 126) / 256, (18 + uv.getY(i) * 110) / 128);
      } else {
        uvs.push(0.5, 0.06);
      }
    }
    for (let i = 0; i < (index?.count ?? position.count); i++) indices.push(base + (index?.getX(i) ?? i));
  };

  const limitX = Math.ceil((size.x / 2 + reach) / spacing);
  const limitZ = Math.ceil((size.z / 2 + reach) / spacing);
  for (let row = -limitZ; row <= limitZ; row++) {
    for (let column = -limitX; column <= limitX; column++) {
      const x = center.x + (column + (random() - 0.5) * 0.7) * spacing;
      const z = center.z + (row + (random() - 0.5) * 0.7) * spacing;
      const nearest = track.nearest(x, z, (segment) => segmentProjection(x, z, segment).distanceSq);
      if (!nearest) continue;
      const { distanceSq, y } = segmentProjection(x, z, nearest);
      if (distanceSq < (urban ? 55 : 67) ** 2 || distanceSq > reach ** 2 || random() < 0.16) continue;
      const pit = pitLane?.path.projectPointPlanar(new THREE.Vector3(x, y, z));
      if (pit && Math.hypot(pit.point.x - x, pit.point.z - z) < 52) continue;

      const buildings = random() < (urban ? 0.83 : 0.17);
      const count = buildings ? urban ? 3 : 2 : 5;
      for (let i = 0; i < count; i++) {
        const px = x + (buildings ? (i - 1) * 24 : (random() - 0.5) * 52);
        const pz = z + (random() - 0.5) * 34;
        const ground = heightAt(px, pz, y);
        if (buildings) {
          const height = urban ? 10 + random() ** 1.6 * 39 : 5 + random() * 7;
          const width = 13 + random() * 9;
          const depth = 10 + random() * 11;
          const color = wallColors[Math.floor(random() * wallColors.length)];
          addShape(box, px, ground + height / 2 - 1.5, pz, width, height, depth, color, Number(height > 20));
          addShape(box, px, ground + height - 1.3, pz, width * 1.04, 0.6, depth * 1.04, roofColor);
        } else {
          const height = 7 + random() * 9;
          const color = treeColors[Math.floor(random() * treeColors.length)];
          const evergreen = random() < 0.38;
          const radius = height * (evergreen ? 0.22 : 0.31);
          addShape(box, px, ground + height * 0.13, pz, 0.4, height * 0.36, 0.4, trunkColor);
          addShape(evergreen ? conifer : canopy, px, ground + height * 0.61, pz,
            radius, height * (evergreen ? 0.78 : 0.39), radius, color);
        }
      }
    }
  }
  box.dispose();
  canopy.dispose();
  conifer.dispose();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, map: createFacadeTexture() });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "circuit-background";
  return mesh;
}
