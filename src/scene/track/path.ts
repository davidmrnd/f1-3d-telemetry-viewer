import * as THREE from "three";
import { SpatialIndex, type BoundsXZ } from "./spatial";

const MIN_POINT_DISTANCE = 0.05;
const DENSE_CONTROL_SPACING_METERS = 10;
const CONTROL_POINT_TOLERANCE_METERS = 0.1;
export const TRACK_PATH_DENSIFY_SPACING_METERS = 4;
export const TRACK_PATH_SMOOTH_SPACING_METERS = 2;

export function cleanCircuitPoints(points: THREE.Vector3[]): THREE.Vector3[] {
  const result: THREE.Vector3[] = [];
  for (const point of points) {
    if (![point.x, point.y, point.z].every(Number.isFinite)) continue;
    const previous = result.at(-1);
    if (!previous || Math.hypot(point.x - previous.x, point.z - previous.z) >= MIN_POINT_DISTANCE) {
      result.push(point.clone());
    }
  }
  return result;
}

export function isClosedCircuitPath(points: THREE.Vector3[], thresholdMeters = 1): boolean {
  return points.length >= 4 && points[0].distanceTo(points[points.length - 1]) <= thresholdMeters;
}

export function normalizeCircuitPath(points: THREE.Vector3[]): { path: THREE.Vector3[]; closed: boolean } {
  const path = cleanCircuitPoints(points);
  const closed = isClosedCircuitPath(path);
  if (closed) path.pop();
  return { path, closed };
}

export function densifyPolylineLinear(points: THREE.Vector3[], spacingMeters = TRACK_PATH_DENSIFY_SPACING_METERS): THREE.Vector3[] {
  if (spacingMeters <= 0) return cleanCircuitPoints(points);
  const result: THREE.Vector3[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const steps = Math.max(1, Math.ceil(points[i].distanceTo(points[i + 1]) / spacingMeters));
    for (let step = 0; step < steps; step++) result.push(points[i].clone().lerp(points[i + 1], step / steps));
  }
  if (points.length) result.push(points[points.length - 1].clone());
  return result;
}

function elevationSlopes(points: THREE.Vector3[], closed: boolean): number[] {
  const n = points.length;
  const count = closed ? n : n - 1;
  const lengths = Array.from({ length: count }, (_, i) =>
    Math.hypot(points[(i + 1) % n].x - points[i].x, points[(i + 1) % n].z - points[i].z));
  const slopes = lengths.map((length, i) => (points[(i + 1) % n].y - points[i].y) / length);
  return points.map((_, i) => {
    if (!closed && i === 0) return slopes[0];
    if (!closed && i === n - 1) return slopes[n - 2];
    const before = (i - 1 + count) % count;
    const after = i % count;
    if (slopes[before] * slopes[after] <= 0) return 0;
    const w1 = 2 * lengths[after] + lengths[before];
    const w2 = lengths[after] + 2 * lengths[before];
    return (w1 + w2) / (w1 / slopes[before] + w2 / slopes[after]);
  });
}

export function smoothPolylineCatmullRom(
  input: THREE.Vector3[], closed: boolean, spacingMeters = TRACK_PATH_SMOOTH_SPACING_METERS,
): THREE.Vector3[] {
  const points = cleanCircuitPoints(input);
  if (closed && points.length > 2 && points[0].distanceTo(points.at(-1)!) < MIN_POINT_DISTANCE) points.pop();
  if (points.length < 3 || spacingMeters <= 0) {
    return densifyPolylineLinear(closed && points.length ? [...points, points[0]] : points, spacingMeters);
  }
  const planar = points.map((p) => new THREE.Vector3(p.x, 0, p.z));
  const curve = new THREE.CatmullRomCurve3(planar, closed, "centripetal");
  const count = closed ? points.length : points.length - 1;
  const slopes = elevationSlopes(points, closed);
  const result: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % points.length;
    const a = points[i];
    const b = points[next];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const divisions = Math.max(8, Math.ceil(length / Math.min(spacingMeters / 2, 1)));
    const dense: THREE.Vector3[] = [];
    for (let j = 0; j <= divisions; j++) {
      const u = j / divisions;
      const p = curve.getPoint((i + u) / count);
      dense.push(p);
    }
    const cumulative = [0];
    for (let j = 0; j <= divisions; j++) {
      const u = j / divisions;
      const p = dense[j];
      p.y = (2 * u ** 3 - 3 * u ** 2 + 1) * a.y + (u ** 3 - 2 * u ** 2 + u) * length * slopes[i]
        + (-2 * u ** 3 + 3 * u ** 2) * b.y + (u ** 3 - u ** 2) * length * slopes[next];
      if (j) cumulative.push(cumulative[j - 1] + p.distanceTo(dense[j - 1]));
    }
    const arcLength = cumulative.at(-1)!;
    const steps = Math.max(1, Math.ceil(arcLength / spacingMeters));
    let cursor = 0;
    for (let j = 0; j < steps; j++) {
      const distance = arcLength * j / steps;
      while (cursor < divisions - 1 && cumulative[cursor + 1] < distance) cursor++;
      const u = (distance - cumulative[cursor]) / Math.max(cumulative[cursor + 1] - cumulative[cursor], 1e-8);
      result.push(dense[cursor].clone().lerp(dense[cursor + 1], u));
    }
  }
  if (!closed) result.push(points.at(-1)!.clone());
  return result;
}

export interface PathSegment extends BoundsXZ {
  a: THREE.Vector3;
  b: THREE.Vector3;
  index: number;
}

export function pathSegments(points: THREE.Vector3[], closed: boolean): PathSegment[] {
  return Array.from({ length: Math.max(0, closed ? points.length : points.length - 1) }, (_, index) => {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    return { a, b, index, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
  });
}

export function segmentProjection(x: number, z: number, segment: PathSegment) {
  const { a, b } = segment;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / Math.max(dx * dx + dz * dz, 1e-12), 0, 1);
  return { y: THREE.MathUtils.lerp(a.y, b.y, t), distanceSq: (x - a.x - dx * t) ** 2 + (z - a.z - dz * t) ** 2 };
}

export function findPathIntersectionsXZ(points: THREE.Vector3[], closed: boolean): [number, number][] {
  const segments = pathSegments(points, closed);
  const index = new SpatialIndex(segments);
  const intersections: [number, number][] = [];
  for (const a of segments) {
    for (const b of index.query(a)) {
      if (b.index <= a.index + 1 || (closed && a.index === 0 && b.index === segments.length - 1)) continue;
      const ax = a.b.x - a.a.x;
      const az = a.b.z - a.a.z;
      const bx = b.b.x - b.a.x;
      const bz = b.b.z - b.a.z;
      const cross = ax * bz - az * bx;
      if (Math.abs(cross) < 1e-9) continue;
      const dx = b.a.x - a.a.x;
      const dz = b.a.z - a.a.z;
      const t = (dx * bz - dz * bx) / cross;
      const u = (dx * az - dz * ax) / cross;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && Math.abs(THREE.MathUtils.lerp(a.a.y, a.b.y, t) - THREE.MathUtils.lerp(b.a.y, b.b.y, u)) < 3) {
        intersections.push([a.index, b.index]);
      }
    }
  }
  return intersections;
}

function simplifyDenseControls(points: THREE.Vector3[], closed: boolean) {
  const source = closed ? [...points, points[0]] : points;
  let length = 0;
  for (let i = 1; i < source.length; i++) length += source[i].distanceTo(source[i - 1]);
  if (length >= (source.length - 1) * DENSE_CONTROL_SPACING_METERS) return points;

  const keep = new Set([0, source.length - 1]);
  const ranges: [number, number][] = [[0, source.length - 1]];
  const chord = new THREE.Vector3();
  const delta = new THREE.Vector3();
  while (ranges.length) {
    const [first, last] = ranges.pop()!;
    chord.subVectors(source[last], source[first]);
    const chordLengthSq = chord.lengthSq();
    let farthest = -1;
    let maxError = CONTROL_POINT_TOLERANCE_METERS ** 2;
    for (let i = first + 1; i < last; i++) {
      delta.subVectors(source[i], source[first]);
      const fraction = chordLengthSq > 0 ? THREE.MathUtils.clamp(delta.dot(chord) / chordLengthSq, 0, 1) : 0;
      const error = delta.addScaledVector(chord, -fraction).lengthSq();
      if (error > maxError) {
        maxError = error;
        farthest = i;
      }
    }
    if (farthest >= 0) {
      keep.add(farthest);
      ranges.push([first, farthest], [farthest, last]);
    }
  }
  const simplified = points.filter((_, index) => keep.has(index));
  if (simplified.length < (closed ? 4 : 2) || findPathIntersectionsXZ(simplified, closed).length) return points;
  return simplified;
}

export function buildVisualCircuitPath(points: THREE.Vector3[], spacingMeters = TRACK_PATH_SMOOTH_SPACING_METERS) {
  const { path, closed } = normalizeCircuitPath(points);
  if (findPathIntersectionsXZ(path, closed).length) {
    throw new Error("La vuelta contiene cruces a la misma altura. No se puede generar una pista válida con estas muestras.");
  }
  const controls = simplifyDenseControls(path, closed);
  const sampled = smoothPolylineCatmullRom(controls, closed, spacingMeters);
  if (findPathIntersectionsXZ(sampled, closed).length) {
    const linear = densifyPolylineLinear(closed ? [...path, path[0]] : path, spacingMeters);
    if (closed) linear.pop();
    return { path: linear, closed };
  }
  return { path: sampled, closed };
}
