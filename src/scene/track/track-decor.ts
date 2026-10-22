import * as THREE from "three";
import type { GraphicsSettings } from "../graphics-settings";
import { getTrackSurfaceMaterials } from "../track-environment";
import { pathSegments, segmentProjection } from "./path";
import { crossSectionPoint, type TrackCrossSection } from "./ribbon";
import { SpatialIndex } from "./spatial";
import { createTerrainHeightSampler } from "./terrain-height";

export interface TrackDecor {
  group: THREE.Group;
  applySettings: (settings: GraphicsSettings) => void;
  dispose: () => void;
}

export function createTrackDecor(
  points: THREE.Vector3[], sections: TrackCrossSection[], closed: boolean,
  width: number, kerbWidth: number, terrain: THREE.BufferGeometry, urban: boolean,
): TrackDecor {
  const group = new THREE.Group();
  group.name = "circuit-equipment";
  const runoffs = new THREE.Group();
  const trackside = new THREE.Group();
  const tyreMarks = new THREE.Group();
  group.add(runoffs, trackside, tyreMarks);
  const materials = getTrackSurfaceMaterials();
  const heightAt = createTerrainHeightSampler(terrain);
  const distances = [0];
  for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + points[i].distanceTo(points[i - 1]));
  const total = distances.at(-1)! + (closed ? points.at(-1)!.distanceTo(points[0]) : 0);
  const wrapIndex = (i: number) => closed ? (i + points.length) % points.length : Math.max(0, Math.min(points.length - 1, i));
  const bends = points.map((point, i) => {
    const a = point.clone().sub(points[wrapIndex(i - 8)]).setY(0);
    const b = points[wrapIndex(i + 8)].clone().sub(point).setY(0);
    const length = Math.max(1, (a.length() + b.length()) / 2);
    return Math.atan2(a.x * b.z - a.z * b.x, a.dot(b)) / length;
  });
  const segments = pathSegments(points, closed);
  const spatial = new SpatialIndex(segments);
  const edge = width / 2 + kerbWidth;
  const profiles = [1, -1].map((side) => sections.map((section, i) => {
    const strength = THREE.MathUtils.smoothstep(-side * bends[i], 0.002, 0.028);
    const insideLimit = side * bends[i] > 0.001
      ? Math.max(0, 0.8 / (Math.abs(bends[i]) * section.lateral.length() * Math.max(section.widthScale, 0.01)) - edge - 1.4)
      : Infinity;
    const desired = Math.min(urban ? 1.3 : 1.2 + strength * 20, insideLimit);
    const nearby = spatial.query({ minX: section.center.x - 45, maxX: section.center.x + 45,
      minZ: section.center.z - 45, maxZ: section.center.z + 45 }).filter((segment) => {
      const distance = Math.abs(distances[i] - distances[segment.index]);
      return (closed ? Math.min(distance, total - distance) : distance) > 85;
    });
    let limit = desired;
    for (let offset = 1; offset <= desired + 3; offset += 1) {
      const position = crossSectionPoint(section, side * (edge + offset));
      if (nearby.some((segment) => segmentProjection(position.x, position.z, segment).distanceSq < (width / 2 + 3) ** 2)) {
        limit = Math.max(0, offset - 3);
        break;
      }
    }
    return limit;
  }));
  for (const profile of profiles) {
    const limits = [...profile];
    for (let i = 0; i < profile.length; i++) {
      for (let step = -12; step <= 12; step++) {
        const next = wrapIndex(i + step);
        const distance = Math.abs(distances[i] - distances[next]);
        profile[i] = Math.min(profile[i], limits[next] + (closed ? Math.min(distance, total - distance) : distance) * 0.3);
      }
    }
  }

  const makeStrip = (
    parent: THREE.Group, side: number, inner: (i: number) => number, outer: (i: number) => number,
    material: THREE.Material, onRoad = false, tile = 3,
  ) => {
    const columns = onRoad ? 1 : 6;
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    const count = points.length + (closed ? 1 : 0);
    for (let row = 0; row < count; row++) {
      const i = row % points.length;
      const distance = row === points.length ? total : distances[i];
      for (let column = 0; column <= columns; column++) {
        const offset = THREE.MathUtils.lerp(inner(i), outer(i), column / columns);
        const p = crossSectionPoint(sections[i], side * offset);
        p.y = (onRoad ? p.y : heightAt(p.x, p.z, p.y)) + (onRoad ? 0.016 : 0.025);
        positions.push(p.x, p.y, p.z);
        uvs.push(offset / tile, distance / tile);
      }
      if (!row) continue;
      for (let column = 0; column < columns; column++) {
        const a = (row - 1) * (columns + 1) + column, b = a + columns + 1;
        if (side > 0) indices.push(a, a + 1, b, a + 1, b + 1, b);
        else indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.renderOrder = onRoad ? 4 : 1;
    parent.add(mesh);
  };

  [1, -1].forEach((side, sideIndex) => {
    const profile = profiles[sideIndex];
    const shoulder = (i: number) => Math.min(profile[i], urban ? 1.3 : 1.2);
    makeStrip(runoffs, side, () => edge, (i) => edge + shoulder(i), urban ? materials.concrete : materials.apron);
    if (!urban) makeStrip(runoffs, side, (i) => edge + shoulder(i), (i) => edge + profile[i], materials.gravel, false, 2);
    makeStrip(group, side, () => width / 2 - 0.23, () => width / 2 - 0.08, materials.white, true);
    for (const offset of [0.85, 1.65]) {
      makeStrip(tyreMarks, side, (i) => offset + Math.sin(distances[i] * 0.004) * 0.45,
        (i) => offset + 0.32 + Math.sin(distances[i] * 0.004) * 0.45, materials.rubber, true);
    }
  });

  const box = new THREE.BoxGeometry(1, 1, 1);
  const plane = new THREE.PlaneGeometry(1, 1);
  const signMaps: THREE.CanvasTexture[] = [];
  const signMaterials: THREE.MeshStandardMaterial[] = [];
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const xAxis = new THREE.Vector3(1, 0, 0);
  const makeMatrix = (position: THREE.Vector3, size: [number, number, number], direction?: THREE.Vector3) => {
    if (direction) rotation.setFromUnitVectors(xAxis, direction.clone().normalize());
    else rotation.identity();
    return matrix.compose(position, rotation, scale.set(...size)).clone();
  };
  const batch = (parent: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, matrices: THREE.Matrix4[]) => {
    if (!matrices.length) return;
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    matrices.forEach((value, i) => mesh.setMatrixAt(i, value));
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    parent.add(mesh);
  };
  const corners: number[] = [];
  const signPosts: THREE.Matrix4[] = [];
  const candidates = bends.map((bend, i) => ({ bend: Math.abs(bend), i })).filter(({ bend }) => bend > 0.012).sort((a, b) => b.bend - a.bend);
  for (const { i } of candidates) {
    if (corners.every((other) => {
      const distance = Math.abs(distances[i] - distances[other]);
      return (closed ? Math.min(distance, total - distance) : distance) > 130;
    })) corners.push(i);
  }
  for (const distance of [150, 100, 50]) {
    const canvas = document.createElement("canvas");
    canvas.width = 256; canvas.height = 192;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#e6e5dc"; ctx.fillRect(0, 0, 256, 192);
    ctx.fillStyle = "#242c2f"; ctx.fillRect(0, 0, 256, 14);
    ctx.font = "bold 105px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(distance), 128, 104);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    signMaps.push(map);
    const material = new THREE.MeshStandardMaterial({ map, roughness: 0.9, side: THREE.DoubleSide });
    signMaterials.push(material);
    const matrices: THREE.Matrix4[] = [];
    for (const corner of corners) {
      let target = distances[corner] - distance;
      if (!closed && target < 0) continue;
      target = (target + total) % total;
      let i = 0;
      while (i < distances.length - 1 && distances[i] < target) i++;
      const side = bends[corner] > 0 ? -1 : 1;
      const p = crossSectionPoint(sections[i], side * (edge + 1.9));
      p.y = heightAt(p.x, p.z, p.y) + 1.05;
      const tangent = points[wrapIndex(i + 1)].clone().sub(points[wrapIndex(i - 1)]).setY(0).normalize();
      const lateral = new THREE.Vector3(-tangent.z, 0, tangent.x);
      matrices.push(makeMatrix(p, [1.25, 0.95, 1], lateral));
      signPosts.push(makeMatrix(p.clone().add(new THREE.Vector3(0, -0.6, 0)), [0.07, 0.9, 0.07]));
    }
    batch(trackside, plane, material, matrices);
  }
  batch(trackside, box, materials.steel, signPosts);
  return {
    group,
    applySettings: (settings) => {
      runoffs.visible = settings.runoffs;
      trackside.visible = settings.trackside;
      tyreMarks.visible = settings.tyreMarks;
    },
    dispose: () => {
      signMaps.forEach((texture) => texture.dispose());
      signMaterials.forEach((material) => material.dispose());
      const geometries = new Set<THREE.BufferGeometry>();
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          geometries.add(object.geometry);
          if (object instanceof THREE.InstancedMesh) object.dispose();
        }
      });
      geometries.forEach((geometry) => geometry.dispose());
    },
  };
}
