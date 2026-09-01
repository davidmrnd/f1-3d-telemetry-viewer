import type { CarSample } from "../types";

const MIN_DIST_SQ = 1e-10;

/**
 * Ángulo Y en el plano XZ de la escena (misma convención que vectorFromPoint: Z = centerZ - z).
 */
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

export function resolveCarHeading(
  samples: CarSample[],
  previous: CarSample,
  next: CarSample,
  current: CarSample,
  previousIndex: number,
  nextIndex: number,
): number {
  const pairs: Array<{ from: { x: number; z: number }; to: { x: number; z: number } }> = [
    { from: current, to: next },
    { from: previous, to: next },
  ];

  const aheadIndex = nextIndex + 1;
  if (aheadIndex < samples.length) {
    pairs.push({ from: current, to: samples[aheadIndex] });
  }

  const behindIndex = previousIndex - 1;
  if (behindIndex >= 0) {
    pairs.push({ from: samples[behindIndex], to: current });
  }

  for (const pair of pairs) {
    const heading = computeMovementHeading(pair.from, pair.to);
    if (heading !== null) {
      return heading;
    }
  }

  return 0;
}
