import * as THREE from "three";
import { pathSegments, segmentProjection, type PathSegment } from "./path";
import { buildTrackCrossSections, crossSectionPoint, type TrackCrossSection } from "./ribbon";
import { SpatialIndex } from "./spatial";

export interface GrassTerrainOptions {
  outerPaddingMeters?: number;
  gridSpacingMeters?: number;
  gridSegments?: number;
  grassTileMeters?: number;
  centerline: THREE.Vector3[];
  centerlineClosed?: boolean;
  trackHalfWidthMeters?: number;
  crossSections?: TrackCrossSection[];
  outerClearanceMeters?: number;
  clearanceFadeMeters?: number;
}

interface Face {
  vertices: [number, number, number];
  active: boolean;
}

const EDGE_KEY_STRIDE = 2 ** 26;
type EdgeKey = number | string;

function edgeKey(a: number, b: number): EdgeKey {
  const first = Math.min(a, b), last = Math.max(a, b);
  return last < EDGE_KEY_STRIDE ? first * EDGE_KEY_STRIDE + last : first + "," + last;
}

function edgeVertices(key: EdgeKey): number[] {
  return typeof key === "number"
    ? [Math.floor(key / EDGE_KEY_STRIDE), key % EDGE_KEY_STRIDE]
    : key.split(",").map(Number);
}

export function createGrassTerrainGeometry(options: GrassTerrainOptions): THREE.BufferGeometry {
  const points = options.centerline;
  const geometry = new THREE.BufferGeometry();
  if (points.length < 2) return geometry;
  const closed = options.centerlineClosed ?? true;
  const halfWidth = options.trackHalfWidthMeters ?? 6.35;
  const sections = options.crossSections ?? buildTrackCrossSections(points, closed, halfWidth);
  const edges = [-halfWidth, halfWidth].map((offset) => sections.map((section) => {
    const p = crossSectionPoint(section, offset);
    return new THREE.Vector3(Math.fround(p.x), Math.fround(p.y), Math.fround(p.z));
  }));
  const boundary: PathSegment[] = edges.flatMap((edge) => pathSegments(edge, closed));
  if (!closed) {
    boundary.push(...pathSegments([edges[0][0], edges[1][0]], false));
    boundary.push(...pathSegments([edges[0].at(-1)!, edges[1].at(-1)!], false));
  }
  const boundaryIndex = new SpatialIndex(boundary);
  const fade = Math.max(1, options.clearanceFadeMeters ?? 24);
  const clearance = options.outerClearanceMeters ?? 0.12;
  const pad = Math.max(40, options.outerPaddingMeters ?? 320);
  const minX = Math.min(...points.map((p) => p.x)) - halfWidth - pad;
  const maxX = Math.max(...points.map((p) => p.x)) + halfWidth + pad;
  const minZ = Math.min(...points.map((p) => p.z)) - halfWidth - pad;
  const maxZ = Math.max(...points.map((p) => p.z)) + halfWidth + pad;
  const rimWidth = Math.max(48, pad * 0.42);
  const rimBaseY = points.reduce((sum, point) => sum + point.y, 0) / points.length - clearance;
  const project = (x: number, z: number) => {
    const edge = boundaryIndex.nearest(x, z, (segment) => segmentProjection(x, z, segment).distanceSq)!;
    return segmentProjection(x, z, edge);
  };
  const naturalHeightAt = (x: number, z: number) => {
    const projection = project(x, z);
    const distance = Math.sqrt(projection.distanceSq);
    if (distance < 1e-5) return projection.y;
    const radius = distance + fade * 2;
    const nearby = boundaryIndex.query({ minX: x - radius, maxX: x + radius, minZ: z - radius, maxZ: z + radius });
    let sum = 0;
    let weightSum = 0;
    for (const edge of nearby) {
      const sample = segmentProjection(x, z, edge);
      const delta = Math.sqrt(sample.distanceSq) - distance;
      if (delta >= fade * 2) continue;
      const weight = (1 - delta / (fade * 2)) ** 2 * Math.hypot(edge.b.x - edge.a.x, edge.b.z - edge.a.z);
      sum += sample.y * weight;
      weightSum += weight;
    }
    const blend = THREE.MathUtils.smoothstep(distance, 0, fade);
    return THREE.MathUtils.lerp(projection.y, weightSum ? sum / weightSum : projection.y, blend) - clearance * blend;
  };
  const heightAt = (x: number, z: number) => {
    const natural = naturalHeightAt(x, z);
    const distToOuter = Math.min(x - minX, maxX - x, z - minZ, maxZ - z);
    const rim = 1 - THREE.MathUtils.smoothstep(distToOuter, 0, rimWidth);
    if (rim <= 1e-5) return natural;
    return THREE.MathUtils.lerp(natural, rimBaseY, rim * rim);
  };
  const vertices: THREE.Vector3[] = [];
  const contours: number[][] = [];
  const faces = new Set<Face>();
  const adjacency = new Map<EdgeKey, Set<Face>>();
  const pending: Face[] = [];
  const addVertex = (x: number, z: number, y = heightAt(x, z)) => {
    vertices.push(new THREE.Vector3(Math.fround(x), Math.fround(y), Math.fround(z)));
    return vertices.length - 1;
  };
  const addFace = (a: number, b: number, c: number) => {
    const p = vertices[a], q = vertices[b], r = vertices[c];
    const area = (q.z - p.z) * (r.x - p.x) - (q.x - p.x) * (r.z - p.z);
    if (Math.abs(area) < 1e-10) return;
    const face: Face = { vertices: area > 0 ? [a, b, c] : [a, c, b], active: true };
    faces.add(face);
    pending.push(face);
    for (let i = 0; i < 3; i++) {
      const key = edgeKey(face.vertices[i], face.vertices[(i + 1) % 3]);
      let entries = adjacency.get(key);
      if (!entries) adjacency.set(key, entries = new Set());
      entries.add(face);
    }
  };
  const removeFace = (face: Face) => {
    face.active = false;
    faces.delete(face);
    for (let i = 0; i < 3; i++) {
      const key = edgeKey(face.vertices[i], face.vertices[(i + 1) % 3]);
      const entries = adjacency.get(key)!;
      entries.delete(face);
      if (!entries.size) adjacency.delete(key);
    }
  };
  const legalize = (queue: EdgeKey[]) => {
    while (queue.length) {
      const key = queue.pop()!;
      const entries = adjacency.get(key);
      if (entries?.size !== 2) continue;
      const [a, b] = edgeVertices(key);
      const [first, second] = [...entries];
      const c = first.vertices.find((id) => id !== a && id !== b)!;
      const d = second.vertices.find((id) => id !== a && id !== b)!;
      const p = vertices[a], q = vertices[b], r = vertices[c], s = vertices[d];
      const side = (u: THREE.Vector3, v: THREE.Vector3, w: THREE.Vector3) =>
        (v.x - u.x) * (w.z - u.z) - (v.z - u.z) * (w.x - u.x);
      if (side(r, s, p) * side(r, s, q) >= -1e-10) continue;
      const cotangent = (u: THREE.Vector3, v: THREE.Vector3, w: THREE.Vector3) =>
        ((u.x - w.x) * (v.x - w.x) + (u.z - w.z) * (v.z - w.z)) / Math.max(1e-20, Math.abs(side(w, u, v)));
      if (cotangent(p, q, r) + cotangent(p, q, s) >= -1e-8) continue;
      removeFace(first);
      removeFace(second);
      addFace(c, d, a);
      addFace(d, c, b);
      queue.push(edgeKey(c, a), edgeKey(a, d), edgeKey(d, b), edgeKey(b, c));
    }
  };
  const triangulate = (outline: THREE.Vector3[], holes: THREE.Vector3[][] = []) => {
    const loops = [outline, ...holes];
    const ids = loops.map((loop) => {
      const contour = loop.map((point) => addVertex(point.x, point.z, point.y));
      contours.push(contour);
      return contour;
    }).flat();
    const planar = loops.map((loop) => loop.map((p) => new THREE.Vector2(p.x, p.z)));
    const triangles = THREE.ShapeUtils.triangulateShape(planar[0], planar.slice(1));
    for (const [a, b, c] of triangles) addFace(ids[a], ids[b], ids[c]);
  };
  const rectangle = [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]]
    .map(([x, z]) => new THREE.Vector3(x, heightAt(x, z), z));
  if (closed) {
    const area = (edge: THREE.Vector3[]) => Math.abs(THREE.ShapeUtils.area(edge.map((p) => new THREE.Vector2(p.x, p.z))));
    const outer = area(edges[0]) > area(edges[1]) ? 0 : 1;
    triangulate(rectangle, [edges[outer]]);
    triangulate(edges[1 - outer]);
  } else {
    triangulate(rectangle, [[...edges[0], ...[...edges[1]].reverse()]]);
  }
  const membership = new Map<number, { contour: number[]; position: number }>();
  for (const contour of contours) contour.forEach((id, position) => membership.set(id, { contour, position }));
  for (const [key, entries] of [...adjacency]) {
    if (entries.size !== 1) continue;
    const [a, b] = edgeVertices(key);
    const first = membership.get(a)!;
    const last = membership.get(b)!;
    if (first.contour !== last.contour) continue;
    const contour = first.contour;
    const forward = (last.position - first.position + contour.length) % contour.length;
    const backward = contour.length - forward;
    const step = forward <= backward ? 1 : -1;
    const count = Math.min(forward, backward);
    if (count <= 1) continue;
    const sequence = Array.from({ length: count + 1 }, (_, i) => contour[(first.position + step * i + contour.length) % contour.length]);
    const start = vertices[a], end = vertices[b];
    const dx = end.x - start.x, dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    if (!sequence.every((id) => Math.abs((vertices[id].x - start.x) * dz - (vertices[id].z - start.z) * dx) <= length * 1e-4)) continue;
    const face = [...entries][0];
    const opposite = face.vertices.find((id) => id !== a && id !== b)!;
    removeFace(face);
    for (let i = 0; i < sequence.length - 1; i++) addFace(sequence[i], sequence[i + 1], opposite);
  }
  const spacing = Math.max(2, options.gridSpacingMeters ?? (options.gridSegments
    ? Math.max(maxX - minX, maxZ - minZ) / options.gridSegments
    : 14));
  const midpointCache = new Map<EdgeKey, number>();
  legalize([...adjacency.keys()]);
  while (pending.length) {
    const face = pending.pop()!;
    if (!face.active) continue;
    let longest = -1;
    let lengthSq = 0;
    for (let i = 0; i < 3; i++) {
      const a = vertices[face.vertices[i]], b = vertices[face.vertices[(i + 1) % 3]];
      const distanceSq = (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
      if (distanceSq > lengthSq) { longest = i; lengthSq = distanceSq; }
    }
    const a = face.vertices[longest], b = face.vertices[(longest + 1) % 3];
    const x = (vertices[a].x + vertices[b].x) / 2;
    const z = (vertices[a].z + vertices[b].z) / 2;
    const distance = Math.sqrt(project(x, z).distanceSq);
    const target = spacing + distance * 0.35;
    if (lengthSq <= target ** 2) continue;
    const key = edgeKey(a, b);
    let middle = midpointCache.get(key);
    if (middle === undefined) {
      const boundaryEdge = adjacency.get(key)!.size === 1;
      middle = addVertex(x, z, boundaryEdge ? (vertices[a].y + vertices[b].y) / 2 : heightAt(x, z));
      midpointCache.set(key, middle);
    }
    const queue: EdgeKey[] = [];
    for (const neighbor of [...adjacency.get(key)!]) {
      const opposite = neighbor.vertices.find((id) => id !== a && id !== b)!;
      removeFace(neighbor);
      addFace(a, middle, opposite);
      addFace(middle, b, opposite);
      queue.push(edgeKey(a, opposite), edgeKey(b, opposite));
    }
    legalize(queue);
  }
  const positions = new Float32Array(vertices.length * 3);
  const uvs = new Float32Array(vertices.length * 2);
  const colors = new Float32Array(vertices.length * 3);
  const tile = Math.max(0.01, options.grassTileMeters ?? 4);
  const edgeStart = halfWidth + pad * 0.42;
  const edgeEnd = halfWidth + pad * 0.98;
  vertices.forEach((p, i) => {
    positions.set([p.x, p.y, p.z], i * 3);
    uvs.set([p.x / tile, p.z / tile], i * 2);
    const variation = 0.88 + Math.sin(p.x * 0.014 + Math.sin(p.z * 0.009)) * 0.05
      + Math.cos(p.z * 0.026 - p.x * 0.008) * 0.035;
    const lateral = Math.sqrt(project(p.x, p.z).distanceSq);
    const edgeFade = THREE.MathUtils.smoothstep(lateral, edgeStart, edgeEnd);
    const tone = THREE.MathUtils.lerp(variation, 0.84, edgeFade * 0.7);
    colors.set([
      THREE.MathUtils.lerp(tone, 0.78, edgeFade * 0.35),
      THREE.MathUtils.lerp(tone, 0.82, edgeFade * 0.35),
      THREE.MathUtils.lerp(tone * 0.94, 0.84, edgeFade * 0.4),
    ], i * 3);
  });
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex([...faces].flatMap((face) => face.vertices));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
