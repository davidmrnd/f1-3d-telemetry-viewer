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

export function computeMovementPitch(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
): number | null {
  const horizontal = Math.hypot(to.x - from.x, to.z - from.z);
  if (horizontal * horizontal < MIN_DIST_SQ) {
    return null;
  }
  return Math.atan2(to.y - from.y, horizontal);
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

function findLookaheadPair(samples: CarSample[], index: number): [CarSample, CarSample] | null {
  if (samples.length === 0) {
    return null;
  }

  const clamped = Math.max(0, Math.min(samples.length - 1, index));
  const from = samples[clamped];

  for (let i = clamped + 1; i < samples.length; i++) {
    if (distSq(from, samples[i]) >= LOOKAHEAD_DIST_SQ) {
      return [from, samples[i]];
    }
  }

  for (let i = samples.length - 1; i > clamped; i--) {
    if (distSq(from, samples[i]) >= MIN_DIST_SQ) {
      return [from, samples[i]];
    }
  }

  for (let i = clamped - 1; i >= 0; i--) {
    if (distSq(samples[i], from) >= LOOKAHEAD_DIST_SQ) {
      return [samples[i], from];
    }
  }

  for (let i = clamped - 1; i >= 0; i--) {
    if (distSq(samples[i], from) >= MIN_DIST_SQ) {
      return [samples[i], from];
    }
  }

  return null;
}

export function orientationAtSampleIndex(
  samples: CarSample[],
  index: number,
): { heading: number; pitch: number } {
  const pair = findLookaheadPair(samples, index);
  if (!pair) {
    return { heading: 0, pitch: 0 };
  }
  return {
    heading: computeMovementHeading(pair[0], pair[1]) ?? 0,
    pitch: computeMovementPitch(pair[0], pair[1]) ?? 0,
  };
}

export function headingAtSampleIndex(samples: CarSample[], index: number): number {
  return orientationAtSampleIndex(samples, index).heading;
}

export function resolveCarOrientation(
  samples: CarSample[],
  previousIndex: number,
  nextIndex: number,
  ratio: number,
): { heading: number; pitch: number } {
  const previous = orientationAtSampleIndex(samples, previousIndex);
  if (previousIndex === nextIndex) {
    return previous;
  }

  const next = orientationAtSampleIndex(samples, nextIndex);
  return {
    heading: lerpAngle(previous.heading, next.heading, ratio),
    pitch: previous.pitch + (next.pitch - previous.pitch) * ratio,
  };
}

export function resolveCarHeading(
  samples: CarSample[],
  previousIndex: number,
  nextIndex: number,
  ratio: number,
): number {
  return resolveCarOrientation(samples, previousIndex, nextIndex, ratio).heading;
}
