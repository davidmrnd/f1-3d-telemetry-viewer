import * as THREE from "three";

export interface TrackProjection {
  distance: number;
  point: THREE.Vector3;
  segmentIndex: number;
}

function projectionSegments(points: readonly THREE.Vector3[]) {
  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dy, dz);
    return {
      start, dx, dy, dz, length,
      denominator: dx * dx + dz * dz,
      minX: Math.min(start.x, start.x + dx), maxX: Math.max(start.x, start.x + dx),
      minZ: Math.min(start.z, start.z + dz), maxZ: Math.max(start.z, start.z + dz),
    };
  });
}

export class TrackPath {
  readonly points: readonly THREE.Vector3[];
  readonly totalLength: number;

  private readonly cumulative: number[];
  private segments?: ReturnType<typeof projectionSegments>;

  constructor(points: THREE.Vector3[], readonly closed = false) {
    this.points = closed && points.length > 1 ? [...points, points[0]] : points;
    this.cumulative = buildCumulativeDistances([...this.points]);
    this.totalLength = this.cumulative.at(-1) ?? 0;
  }

  get centroid(): THREE.Vector3 {
    if (this.points.length === 0) {
      return new THREE.Vector3();
    }
    const sum = new THREE.Vector3();
    for (const point of this.points) {
      sum.add(point);
    }
    return sum.divideScalar(this.points.length);
  }

  projectPointPlanar(point: THREE.Vector3): TrackProjection | null {
    if (this.points.length < 2) {
      return null;
    }

    let bestDistance = Number.POSITIVE_INFINITY;
    let bestPoint = this.points[0].clone();
    let bestSegment = 0;
    let bestArc = 0;

    const segments = this.segments ??= projectionSegments(this.points);
    const { x, z } = point;
    for (let index = 0; index < segments.length; index += 1) {
      const { start, dx, dy, dz, length, denominator, minX, maxX, minZ, maxZ } = segments[index];
      const boundX = Math.max(minX - x, 0, x - maxX);
      const boundZ = Math.max(minZ - z, 0, z - maxZ);
      if (boundX * boundX + boundZ * boundZ >= bestDistance) continue;
      if (length <= 1e-6 || denominator <= 1e-8) continue;
      const fraction = THREE.MathUtils.clamp(
        ((x - start.x) * dx + (z - start.z) * dz) / denominator,
        0, 1,
      );
      const px = start.x + dx * fraction;
      const py = start.y + dy * fraction;
      const pz = start.z + dz * fraction;
      const distanceSq = (px - x) ** 2 + (pz - z) ** 2;

      if (distanceSq < bestDistance) {
        bestDistance = distanceSq;
        bestPoint.set(px, py, pz);
        bestSegment = index;
        bestArc = this.cumulative[index] + fraction * length;
      }
    }

    return {
      distance: bestArc,
      point: bestPoint,
      segmentIndex: bestSegment,
    };
  }

  linearDistance(a: number, b: number): number {
    return Math.abs(this.signedDistance(a, b));
  }

  signedDistance(from: number, to: number): number {
    const distance = to - from;
    if (!this.closed || this.totalLength <= 0) return distance;
    return THREE.MathUtils.euclideanModulo(distance + this.totalLength / 2, this.totalLength) - this.totalLength / 2;
  }

  pointAt(distance: number): THREE.Vector3 {
    if (this.totalLength <= 0) return this.points[0]?.clone() ?? new THREE.Vector3();
    const { index, fraction } = this.segmentAt(distance);
    return this.points[index].clone().lerp(this.points[index + 1], fraction);
  }

  segmentAt(distance: number): { index: number; fraction: number } {
    const arc = this.closed
      ? THREE.MathUtils.euclideanModulo(distance, this.totalLength)
      : THREE.MathUtils.clamp(distance, 0, this.totalLength);
    let lo = 0;
    let hi = this.cumulative.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cumulative[mid] <= arc) lo = mid;
      else hi = mid;
    }
    const length = this.cumulative[hi] - this.cumulative[lo];
    return { index: lo, fraction: length > 0 ? (arc - this.cumulative[lo]) / length : 0 };
  }

  tangentAt(projection: TrackProjection): THREE.Vector3 {
    const start = this.points[projection.segmentIndex];
    const end = this.points[projection.segmentIndex + 1] ?? start;
    const tangent = end.clone().sub(start);
    tangent.y = 0;
    if (tangent.lengthSq() > 1e-8) {
      tangent.normalize();
    } else {
      tangent.set(0, 0, 1);
    }
    return tangent;
  }
}

function buildCumulativeDistances(points: THREE.Vector3[]): number[] {
  const cumulative = [0];
  for (let index = 0; index < points.length - 1; index += 1) {
    cumulative.push(cumulative[index] + points[index].distanceTo(points[index + 1]));
  }
  return cumulative;
}
