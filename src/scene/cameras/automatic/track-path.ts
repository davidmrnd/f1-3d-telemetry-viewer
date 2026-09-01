import * as THREE from "three";

export interface TrackProjection {
  distance: number;
  point: THREE.Vector3;
  segmentIndex: number;
}

export class TrackPath {
  readonly points: readonly THREE.Vector3[];
  readonly totalLength: number;

  private readonly cumulative: number[];

  constructor(points: THREE.Vector3[]) {
    this.points = points;
    this.cumulative = buildCumulativeDistances(points);
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

  projectPoint(point: THREE.Vector3): TrackProjection | null {
    return this.projectPointInternal(point, false);
  }

  projectPointPlanar(point: THREE.Vector3): TrackProjection | null {
    return this.projectPointInternal(point, true);
  }

  private projectPointInternal(point: THREE.Vector3, planar: boolean): TrackProjection | null {
    if (this.points.length < 2) {
      return null;
    }

    let bestDistance = Number.POSITIVE_INFINITY;
    let bestPoint = this.points[0].clone();
    let bestSegment = 0;
    let bestArc = 0;

    for (let index = 0; index < this.points.length - 1; index += 1) {
      const start = this.points[index];
      const end = this.points[index + 1];
      const segment = end.clone().sub(start);
      const length = segment.length();
      if (length <= 1e-6) {
        continue;
      }

      segment.divideScalar(length);
      const t = THREE.MathUtils.clamp(point.clone().sub(start).dot(segment), 0, length);
      const projected = start.clone().add(segment.clone().multiplyScalar(t));
      const distanceSq = planar
        ? (projected.x - point.x) ** 2 + (projected.z - point.z) ** 2
        : projected.distanceToSquared(point);

      if (distanceSq < bestDistance) {
        bestDistance = distanceSq;
        bestPoint = projected;
        bestSegment = index;
        bestArc = this.cumulative[index] + t;
      }
    }

    return {
      distance: bestArc,
      point: bestPoint,
      segmentIndex: bestSegment,
    };
  }

  linearDistance(a: number, b: number): number {
    return Math.abs(a - b);
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
