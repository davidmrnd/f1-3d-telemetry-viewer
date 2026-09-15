import type { CarSample } from "../types";

const LOOKAHEAD_DIST = 50;
const LOOKAHEAD_DIST_SQ = LOOKAHEAD_DIST * LOOKAHEAD_DIST;
const MIN_DIST_SQ = 1e-6;

export function computeMovementHeading(
  from: { x: number; z: number },
  to: { x: number; z: number },
): number | null {
  const dx = to.x - from.x;
  const dz = from.z - to.z;
  if (dx * dx + dz * dz < MIN_DIST_SQ) {
    return null;
  }
  return Math.atan2(dz, dx);
}

function shortestAngleDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) {
    delta -= Math.PI * 2;
  }
  while (delta < -Math.PI) {
    delta += Math.PI * 2;
  }
  return delta;
}

export function lerpAngle(from: number, to: number, ratio: number): number {
  return from + shortestAngleDelta(from, to) * ratio;
}

function distSq(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return dx * dx + dz * dz;
}

export function headingAtSampleIndex(samples: CarSample[], index: number): number {
  if (samples.length === 0) {
    return 0;
  }

  const clamped = Math.max(0, Math.min(samples.length - 1, index));
  const from = samples[clamped];

  for (let i = clamped + 1; i < samples.length; i++) {
    if (distSq(from, samples[i]) >= LOOKAHEAD_DIST_SQ) {
      return computeMovementHeading(from, samples[i]) ?? 0;
    }
  }

  for (let i = samples.length - 1; i > clamped; i--) {
    const heading = computeMovementHeading(from, samples[i]);
    if (heading !== null) {
      return heading;
    }
  }

  for (let i = clamped - 1; i >= 0; i--) {
    if (distSq(samples[i], from) >= LOOKAHEAD_DIST_SQ) {
      return computeMovementHeading(samples[i], from) ?? 0;
    }
  }

  for (let i = clamped - 1; i >= 0; i--) {
    const heading = computeMovementHeading(samples[i], from);
    if (heading !== null) {
      return heading;
    }
  }

  return 0;
}

export function resolveCarHeading(
  samples: CarSample[],
  previousIndex: number,
  nextIndex: number,
  ratio: number,
): number {
  const headingPrevious = headingAtSampleIndex(samples, previousIndex);
  if (previousIndex === nextIndex) {
    return headingPrevious;
  }

  const headingNext = headingAtSampleIndex(samples, nextIndex);
  return lerpAngle(headingPrevious, headingNext, ratio);
}
