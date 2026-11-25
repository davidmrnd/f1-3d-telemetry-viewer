import { MathUtils } from "three";
import { CAR_FOOTPRINT_RADIUS, carMotion, sweptClearanceAlong, type TrafficPose } from "./car-footprint";
import { SIDE_BY_SIDE_DISTANCE, type TrafficTarget } from "./traffic-planner";

const MAX_SHIFT = 2;
export const MAX_LINE_HEADING = 0.12;
export const LINE_HEADING_CHORD = 2 * Math.sin(MAX_LINE_HEADING / 2);
const MIN_SWEEP_GAP = 2 * (CAR_FOOTPRINT_RADIUS + MAX_SHIFT);
const FOLLOWING_RANGE = 60;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export interface TrafficLineFrame {
  time: number;
  targets: (TrafficTarget & { allowLineVariation: boolean })[];
  poses: Map<number, TrafficPose>;
}

interface LineCar {
  target: TrafficLineFrame["targets"][number];
  pose: TrafficPose;
  before: TrafficPose;
  after: TrafficPose;
  fx: number;
  fz: number;
  speed: number;
  distance: number;
  lane: number;
}

function sweptGap(dx: number, dz: number, endX: number, endZ: number): number {
  const vx = endX - dx, vz = endZ - dz;
  const lengthSquared = vx * vx + vz * vz;
  const u = lengthSquared > 0 ? MathUtils.clamp(-(dx * vx + dz * vz) / lengthSquared, 0, 1) : 0;
  return Math.hypot(dx + vx * u, dz + vz * u);
}

export class TrafficLineVariation {
  private offsets = new Map<number, number>();
  private readonly distances = new Map<number, number>();

  constructor(private readonly laneLimits: (pose: TrafficPose) => readonly [number, number] | null) {}

  sample(frame: TrafficLineFrame, previous: TrafficLineFrame | undefined, next: TrafficLineFrame | undefined) {
    const dt = previous ? (frame.time - previous.time) / 1000 : 0;
    const cars: LineCar[] = frame.targets.map(target => {
      const pose = frame.poses.get(target.id)!;
      const before = previous?.poses.get(target.id) ?? pose;
      const after = next?.poses.get(target.id) ?? pose;
      const fx = Math.cos(pose.heading), fz = Math.sin(pose.heading);
      const advance = (pose.x - before.x) * fx + (pose.z - before.z) * fz;
      const speed = dt > 0 ? advance / dt : 0;
      const distance = (this.distances.get(target.id) ?? 0) + Math.max(0, advance);
      this.distances.set(target.id, distance);
      const lane = Math.abs((pose.z - target.z) * fx - (pose.x - target.x) * fz);
      return { target, pose, before, after, fx, fz, speed, distance, lane };
    });
    const offsets = new Map<number, number>();
    for (const car of cars) {
      const offset = this.offsetFor(car, cars, dt);
      if (offset !== 0) offsets.set(car.target.id, offset);
    }
    this.offsets = offsets;
    return offsets;
  }

  private offsetFor(car: LineCar, cars: LineCar[], dt: number): number {
    const { target, pose, before, after, fx, fz, speed, distance, lane } = car;
    if (!target.allowLineVariation || speed <= 0) return 0;
    const onLine = 1 - MathUtils.smoothstep(lane, 0.25, 0.85);
    if (onLine === 0) return 0;

    let following = 0;
    let clearance = 1;
    for (const other of cars) {
      if (other === car) continue;
      const dx = other.pose.x - pose.x, dz = other.pose.z - pose.z;
      if (Math.abs(dx) > FOLLOWING_RANGE || Math.abs(dz) > FOLLOWING_RANGE) continue;
      const gap = Math.min(
        sweptGap(dx, dz, other.before.x - before.x, other.before.z - before.z),
        sweptGap(dx, dz, other.after.x - after.x, other.after.z - after.z),
      );
      let room = MathUtils.smoothstep(gap, MIN_SWEEP_GAP, MIN_SWEEP_GAP + 4);
      if (room < 1) {
        const beforeGap = sweptClearanceAlong(
          carMotion(before, pose), carMotion(other.before, other.pose), fx, fz, MAX_SHIFT, LINE_HEADING_CHORD,
        );
        const afterGap = sweptClearanceAlong(
          carMotion(pose, after), carMotion(other.pose, other.after), fx, fz, MAX_SHIFT, LINE_HEADING_CHORD,
        );
        room = Math.max(room, MathUtils.smoothstep(Math.min(beforeGap, afterGap), 0.15, 1.25));
      }
      clearance = Math.min(clearance, room);
      if (clearance === 0) return 0;
      if (Math.abs(other.pose.y - pose.y) > 2 || fx * other.fx + fz * other.fz < 0.8) continue;

      const along = dx * fx + dz * fz;
      const side = Math.abs(dz * fx - dx * fz);
      const longitudinalGap = Math.abs(along);
      const closing = Math.sign(along) * (speed - other.speed);
      const overlapIn = (longitudinalGap - SIDE_BY_SIDE_DISTANCE) / Math.max(0.01, closing);
      const approaching = 1 - MathUtils.smoothstep(overlapIn, 3, 5);
      const returning = MathUtils.smoothstep(Math.max(lane, other.lane), 0.08, 0.3)
        * (1 - MathUtils.smoothstep(longitudinalGap, 14, 22));
      const passing = Math.max(approaching, returning) * (1 - MathUtils.smoothstep(side, 4, 8));
      clearance = Math.min(clearance, 1 - passing);
      if (clearance === 0) return 0;

      if (!other.target.allowLineVariation) continue;
      const nearby = (1 - MathUtils.smoothstep(longitudinalGap, 32, FOLLOWING_RANGE))
        * (1 - MathUtils.smoothstep(side, 2.5, 5.5));
      following = Math.max(following, nearby);
    }

    const previousOffset = this.offsets.get(target.id) ?? 0;
    if (following === 0 && Math.abs(previousOffset) < 0.001) return 0;
    const limits = this.laneLimits(pose);
    if (!limits || limits[0] > 0 || limits[1] < 0) return 0;

    const phase = target.id * GOLDEN_ANGLE;
    const line = 0.75 * Math.cos(phase) + 0.25 * Math.sin(phase + distance / 85);
    const maxShift = MAX_SHIFT * clearance * onLine;
    const offset = MathUtils.lerp(previousOffset, line * maxShift * following, 1 - Math.exp(-dt / 0.35));
    return MathUtils.clamp(offset, Math.max(-maxShift, limits[0] * 0.7), Math.min(maxShift, limits[1] * 0.7));
  }
}
