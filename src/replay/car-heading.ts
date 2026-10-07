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
