import type { TrackPoint3D } from "../../types";
import { intervalIndexAt, upperBound } from "./sorted-search";

export interface Polyline3 {
  arcLengths: Float64Array;
  xs: Float64Array;
  ys: Float64Array;
  zs: Float64Array;
}

export interface UniformResampling {
  xs: Float64Array;
  ys: Float64Array;
  zs: Float64Array;
  step: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function polylineFromCoordinates(xs: Float64Array, ys: Float64Array, zs: Float64Array): Polyline3 {
  const arcLengths = new Float64Array(xs.length);
  for (let index = 1; index < xs.length; index += 1) {
    arcLengths[index] =
      arcLengths[index - 1] +
      Math.hypot(xs[index] - xs[index - 1], ys[index] - ys[index - 1], zs[index] - zs[index - 1]);
  }
  return { arcLengths, xs, ys, zs };
}

export function polylineLength(line: Polyline3): number {
  return line.arcLengths[line.arcLengths.length - 1];
}

export function linearPointOnPolyline(line: Polyline3, distance: number): TrackPoint3D {
  const { arcLengths, xs, ys, zs } = line;
  if (arcLengths.length < 2) {
    return { x: xs[0], y: ys[0], z: zs[0] };
  }

  const index = intervalIndexAt(arcLengths, distance);
  const span = arcLengths[index + 1] - arcLengths[index];
  const ratio = span > 0 ? clamp01((distance - arcLengths[index]) / span) : 0;
  return {
    x: xs[index] + (xs[index + 1] - xs[index]) * ratio,
    y: ys[index] + (ys[index + 1] - ys[index]) * ratio,
    z: zs[index] + (zs[index + 1] - zs[index]) * ratio,
  };
}

export function projectOntoPolyline(
  line: Polyline3,
  point: TrackPoint3D,
  around: number,
  radius: number,
): number {
  const { arcLengths, xs, ys, zs } = line;
  if (arcLengths.length < 2) {
    return 0;
  }

  const first = Math.max(0, upperBound(arcLengths, around - radius) - 1);
  const last = Math.min(arcLengths.length - 1, upperBound(arcLengths, around + radius));
  let best = around;
  let bestDistanceSq = Number.POSITIVE_INFINITY;

  for (let index = first; index < last; index += 1) {
    const ex = xs[index + 1] - xs[index];
    const ey = ys[index + 1] - ys[index];
    const ez = zs[index + 1] - zs[index];
    const lengthSq = ex * ex + ey * ey + ez * ez;
    const ratio =
      lengthSq > 0
        ? clamp01(((point.x - xs[index]) * ex + (point.y - ys[index]) * ey + (point.z - zs[index]) * ez) / lengthSq)
        : 0;
    const dx = xs[index] + ex * ratio - point.x;
    const dy = ys[index] + ey * ratio - point.y;
    const dz = zs[index] + ez * ratio - point.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      best = arcLengths[index] + (arcLengths[index + 1] - arcLengths[index]) * ratio;
    }
  }

  return best;
}

export function resampleUniformly(line: Polyline3, targetStep: number): UniformResampling {
  const length = polylineLength(line);
  const count = Math.max(2, Math.ceil(length / targetStep) + 1);
  const step = length / (count - 1);
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const zs = new Float64Array(count);

  for (let index = 0; index < count; index += 1) {
    const point = linearPointOnPolyline(line, index * step);
    xs[index] = point.x;
    ys[index] = point.y;
    zs[index] = point.z;
  }

  return { xs, ys, zs, step };
}
