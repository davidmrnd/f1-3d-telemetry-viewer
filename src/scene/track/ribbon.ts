import * as THREE from "three";
import { findPathIntersectionsXZ } from "./path";

export interface TrackCrossSection {
  center: THREE.Vector3;
  lateral: THREE.Vector3;
  widthScale: number;
}

export interface TrackRibbonOptions {
  tileSizeMeters?: number;
  closed?: boolean;
  offsetMeters?: number;
  crossSections?: TrackCrossSection[];
  skipSegment?: (index: number) => boolean;
}

function widthNeighborhoods(sections: TrackCrossSection[], closed: boolean) {
  const radius = 12;
  return sections.map((_section, index) => {
    const neighbors = [{ index, weight: 1 }];
    for (const direction of [-1, 1]) {
      let previous = index;
      let distance = 0;
      for (let step = 1; step < sections.length; step++) {
        const candidate = index + step * direction;
        if (!closed && (candidate < 0 || candidate >= sections.length)) break;
        const next = (candidate + sections.length) % sections.length;
        const a = sections[previous].center;
        const b = sections[next].center;
        distance += Math.hypot(a.x - b.x, a.z - b.z);
        if (distance > radius + 1e-8) break;
        neighbors.push({ index: next, weight: (1 + Math.cos(Math.PI * Math.min(distance / radius, 1))) / 2 });
        previous = next;
      }
    }
    return neighbors;
  });
}

function smoothWidthLimits(sections: TrackCrossSection[], limits: number[], neighborhoods: ReturnType<typeof widthNeighborhoods>) {
  const minimums = neighborhoods.map((neighbors) =>
    Math.min(...neighbors.map(({ index }) => limits[index])));
  for (let i = 0; i < sections.length; i++) {
    let sum = 0;
    let weights = 0;
    for (const { index, weight } of neighborhoods[i]) {
      sum += minimums[index] * weight;
      weights += weight;
    }
    sections[i].widthScale = Math.min(limits[i], sum / weights);
  }
}

export function buildTrackCrossSections(points: THREE.Vector3[], closed: boolean, maxOffset: number): TrackCrossSection[] {
  const sections = points.map((center, i) => {
    const before = points[closed ? (i - 1 + points.length) % points.length : Math.max(0, i - 1)];
    const after = points[closed ? (i + 1) % points.length : Math.min(points.length - 1, i + 1)];
    const incoming = new THREE.Vector3(center.x - before.x, 0, center.z - before.z);
    const outgoing = new THREE.Vector3(after.x - center.x, 0, after.z - center.z);
    const length = Math.min(incoming.length() || Infinity, outgoing.length() || Infinity);
    if (incoming.lengthSq() < 1e-10) incoming.copy(outgoing);
    if (outgoing.lengthSq() < 1e-10) outgoing.copy(incoming);
    if (incoming.lengthSq() < 1e-10) incoming.set(1, 0, 0);
    if (outgoing.lengthSq() < 1e-10) outgoing.copy(incoming);
    incoming.normalize();
    outgoing.normalize();
    const tangent = incoming.clone().add(outgoing);
    if (tangent.lengthSq() < 1e-8) tangent.copy(outgoing);
    tangent.normalize();
    const lateral = new THREE.Vector3(-tangent.z, 0, tangent.x);
    const miter = Math.min(1.5, 1 / Math.max(0.1, tangent.dot(incoming)));
    lateral.multiplyScalar(miter);
    const sinHalf = Math.sqrt(Math.max(0, (1 - incoming.dot(outgoing)) / 2));
    const radius = sinHalf > 1e-6 ? length / (2 * sinHalf) : Infinity;
    const widthScale = maxOffset > 0 ? Math.min(1, radius * 0.8 / (maxOffset * miter)) : 1;
    return { center, lateral, widthScale };
  });
  const widthLimits = sections.map((section) => section.widthScale);
  const neighborhoods = widthNeighborhoods(sections, closed);
  for (let pass = 0; pass < 64; pass++) {
    smoothWidthLimits(sections, widthLimits, neighborhoods);
    let changed = false;
    const reduceWidth = (index: number) => {
      widthLimits[index] = Math.min(widthLimits[index], sections[index].widthScale * 0.9);
      changed = true;
    };
    for (const sign of [-1, 1]) {
      const edge = sections.map((section) => crossSectionPoint(section, sign * maxOffset));
      for (let i = 0; i < (closed ? points.length : points.length - 1); i++) {
        const next = (i + 1) % points.length;
        const dx = points[next].x - points[i].x;
        const dz = points[next].z - points[i].z;
        if ((edge[next].x - edge[i].x) * dx + (edge[next].z - edge[i].z) * dz <= 1e-8) {
          reduceWidth(i);
          reduceWidth(next);
        }
      }
      for (const [a, b] of findPathIntersectionsXZ(edge, closed)) {
        for (const i of new Set([a, (a + 1) % points.length, b, (b + 1) % points.length])) reduceWidth(i);
      }
    }
    if (!changed) break;
  }
  smoothWidthLimits(sections, widthLimits, neighborhoods);
  return sections;
}

export function crossSectionPoint(section: TrackCrossSection, offset: number): THREE.Vector3 {
  return section.center.clone().addScaledVector(section.lateral, offset * section.widthScale);
}

export function createTrackRibbon(points: THREE.Vector3[], width: number, options: TrackRibbonOptions = {}): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  if (points.length < 2 || width <= 0) return geometry;
  const closed = options.closed ?? true;
  const offset = options.offsetMeters ?? 0;
  const sections = options.crossSections ?? buildTrackCrossSections(points, closed, Math.abs(offset) + width / 2);
  const tile = Math.max(0.01, options.tileSizeMeters ?? 2);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let distance = 0;
  const count = points.length + (closed ? 1 : 0);
  for (let i = 0; i < count; i++) {
    const row = i % points.length;
    if (i) distance += points[(i - 1) % points.length].distanceTo(points[row]);
    const left = crossSectionPoint(sections[row], offset + width / 2);
    const right = crossSectionPoint(sections[row], offset - width / 2);
    positions.push(...[left.x, left.y, left.z, right.x, right.y, right.z].map(Math.fround));
    uvs.push(0, distance / tile, width / tile, distance / tile);
  }
  const add = (a: number, b: number, c: number) => {
    const area = (positions[b * 3 + 2] - positions[a * 3 + 2]) * (positions[c * 3] - positions[a * 3])
      - (positions[b * 3] - positions[a * 3]) * (positions[c * 3 + 2] - positions[a * 3 + 2]);
    if (Math.abs(area) <= 1e-8) return;
    indices.push(a, area > 0 ? b : c, area > 0 ? c : b);
  };
  for (let i = 0; i < count - 1; i++) {
    if (options.skipSegment?.(i)) continue;
    add(i * 2, i * 2 + 2, i * 2 + 1);
    add(i * 2 + 2, i * 2 + 3, i * 2 + 1);
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  if (closed) {
    const normal = geometry.getAttribute("normal");
    for (let side = 0; side < 2; side++) {
      const end = (count - 1) * 2 + side;
      const value = new THREE.Vector3().fromBufferAttribute(normal, side).add(new THREE.Vector3().fromBufferAttribute(normal, end)).normalize();
      normal.setXYZ(side, value.x, value.y, value.z);
      normal.setXYZ(end, value.x, value.y, value.z);
    }
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
