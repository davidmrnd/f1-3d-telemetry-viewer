import { F1_CAR_LENGTH_METERS } from "../track-geometry";
import type { VehiclePose } from "../../types";

export type TrafficPose = VehiclePose;

const HALF_LENGTH = F1_CAR_LENGTH_METERS / 2 + 0.07;
export const HALF_WIDTH = 1.12;
const MODEL_HEIGHT = 1.2;
export const CAR_FOOTPRINT_RADIUS = Math.hypot(HALF_LENGTH + MODEL_HEIGHT, HALF_WIDTH);

export function angleDelta(from: number, to: number): number {
  const delta = to - from;
  return Math.atan2(Math.sin(delta), Math.cos(delta));
}

export function interpolatePose(from: TrafficPose, to: TrafficPose, u: number): TrafficPose {
  return {
    x: from.x + (to.x - from.x) * u,
    y: from.y + (to.y - from.y) * u,
    z: from.z + (to.z - from.z) * u,
    heading: from.heading + angleDelta(from.heading, to.heading) * u,
    pitch: from.pitch + (to.pitch - from.pitch) * u,
  };
}

export function carMotion(from: TrafficPose, to: TrafficPose) {
  const pitch = Math.min(Math.PI / 2, Math.max(Math.abs(from.pitch), Math.abs(to.pitch)));
  const tilt = Math.sin(pitch);
  const length = HALF_LENGTH + MODEL_HEIGHT * tilt;
  const verticalMargin = HALF_LENGTH * tilt;
  const stationary = from === to;
  const yaw = stationary && Number.isFinite(from.heading) ? 0 : Math.abs(angleDelta(from.heading, to.heading));
  const ax = Math.cos(from.heading), az = Math.sin(from.heading);
  return {
    from, to, length, verticalMargin,
    rotationMargin: Math.hypot(length, HALF_WIDTH) * yaw * yaw / 8,
    ax, az,
    bx: stationary ? ax : Math.cos(to.heading), bz: stationary ? az : Math.sin(to.heading),
    minX: Math.min(from.x, to.x), maxX: Math.max(from.x, to.x),
    minZ: Math.min(from.z, to.z), maxZ: Math.max(from.z, to.z),
  };
}

export type CarMotion = ReturnType<typeof carMotion>;

function projectionRadius(length: number, fx: number, fz: number, x: number, z: number): number {
  return length * Math.abs(x * fx + z * fz) + HALF_WIDTH * Math.abs(z * fx - x * fz);
}

export function sweptClearanceAlong(
  a: CarMotion, b: CarMotion, x: number, z: number, maxSideShift: number, headingChord: number,
): number {
  const start = (b.from.x - a.from.x) * x + (b.from.z - a.from.z) * z;
  const end = (b.to.x - a.to.x) * x + (b.to.z - a.to.z) * z;
  const sign = Math.sign(start);
  const clearance = (gap: number, ax: number, az: number, bx: number, bz: number) =>
    sign * gap - projectionRadius(a.length, ax, az, x, z) - projectionRadius(b.length, bx, bz, x, z)
    - maxSideShift * (Math.abs(ax * z - az * x) + Math.abs(bx * z - bz * x));
  const headingMargin = headingChord * (Math.hypot(a.length, HALF_WIDTH) + Math.hypot(b.length, HALF_WIDTH));
  return Math.min(clearance(start, a.ax, a.az, b.ax, b.az), clearance(end, a.bx, a.bz, b.bx, b.bz))
    - a.rotationMargin - b.rotationMargin - headingMargin;
}

function mayConflict(a: CarMotion, b: CarMotion): boolean {
  const reach = 2 * CAR_FOOTPRINT_RADIUS;
  if (a.minX - b.maxX > reach || b.minX - a.maxX > reach ||
    a.minZ - b.maxZ > reach || b.minZ - a.maxZ > reach) return false;

  const dx = b.from.x - a.from.x;
  const dz = b.from.z - a.from.z;
  const vx = b.to.x - a.to.x - dx;
  const vz = b.to.z - a.to.z - dz;
  let enter = 0;
  let exit = 1;

  function clip(start: number, end: number): boolean {
    if (start > 0 && end > 0) return false;
    if (start > 0) enter = Math.max(enter, start / (start - end));
    if (end > 0) exit = Math.min(exit, start / (start - end));
    return enter <= exit;
  }

  const dy = b.from.y - a.from.y;
  const endY = b.to.y - a.to.y;
  const rotation = a.rotationMargin + b.rotationMargin;
  function testAxis(x: number, z: number): boolean {
    const from = dx * x + dz * z;
    const to = from + vx * x + vz * z;
    const r0 = projectionRadius(a.length, a.ax, a.az, x, z) + projectionRadius(b.length, b.ax, b.az, x, z) + rotation;
    const r1 = projectionRadius(a.length, a.bx, a.bz, x, z) + projectionRadius(b.length, b.bx, b.bz, x, z) + rotation;
    return clip(from - r0, to - r1) && clip(-from - r0, -to - r1);
  }

  const height = MODEL_HEIGHT + a.verticalMargin + b.verticalMargin;
  return clip(dy - height, endY - height) && clip(-dy - height, -endY - height)
    && testAxis(a.ax, a.az) && testAxis(-a.az, a.ax)
    && testAxis(b.ax, b.az) && testAxis(-b.az, b.ax)
    && testAxis(a.bx, a.bz) && testAxis(-a.bz, a.bx)
    && testAxis(b.bx, b.bz) && testAxis(-b.bz, b.bx);
}

export function motionsConflict(a: CarMotion, b: CarMotion, depth = 2): boolean {
  if (!mayConflict(a, b)) return false;
  if (depth === 0 || a.rotationMargin + b.rotationMargin < 1e-6) return true;
  const midA = interpolatePose(a.from, a.to, 0.5);
  const midB = interpolatePose(b.from, b.to, 0.5);
  return motionsConflict(carMotion(midA, a.to), carMotion(midB, b.to), depth - 1) ||
    motionsConflict(carMotion(a.from, midA), carMotion(b.from, midB), depth - 1);
}

export function separatingContact(a: TrafficPose, b: TrafficPose) {
  if (Math.abs(a.x - b.x) > 2 * CAR_FOOTPRINT_RADIUS || Math.abs(a.z - b.z) > 2 * CAR_FOOTPRINT_RADIUS) return null;
  const am = carMotion(a, a);
  const bm = carMotion(b, b);
  if (Math.abs(a.y - b.y) >= MODEL_HEIGHT + am.verticalMargin + bm.verticalMargin) return null;
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  let contact = { x: 0, z: 0, depth: Infinity };
  for (const [x, z] of [[am.ax, am.az], [-am.az, am.ax], [bm.ax, bm.az], [-bm.az, bm.ax]]) {
    const separation = dx * x + dz * z;
    const depth = projectionRadius(am.length, am.ax, am.az, x, z)
      + projectionRadius(bm.length, bm.ax, bm.az, x, z) - Math.abs(separation);
    if (depth <= 0) return null;
    if (depth < contact.depth) {
      const side = separation < 0 ? -1 : 1;
      contact = { x: x * side, z: z * side, depth };
    }
  }
  return contact;
}
