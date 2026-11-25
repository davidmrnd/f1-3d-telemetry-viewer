import { MathUtils, Vector3 } from "three";
import type { ReplayFrame } from "../../types";
import type { BaseCarPlacement } from "../car-placement";
import { pathSegments, segmentProjection } from "../track/path";
import { SpatialIndex } from "../track/spatial";
import { angleDelta, CAR_FOOTPRINT_RADIUS, HALF_WIDTH, type TrafficPose } from "./car-footprint";
import {
  LINE_HEADING_CHORD, MAX_LINE_HEADING, TrafficLineVariation, type TrafficLineFrame,
} from "./traffic-line-variation";
import { TrafficPlanner, type TrafficPace } from "./traffic-planner";

export interface TrafficRoad {
  points: Vector3[];
  closed: boolean;
  width: number;
}

interface TrafficPlacement extends BaseCarPlacement {
  allowLineVariation: boolean;
}

const STEP_MS = 50;
const POSE_SIZE = 5;
const MAX_LINE_SPEED = 1.4;
const MAX_LINE_YAW_RATE = 0.4;
const MAX_LINE_SLOPE = Math.tan(MAX_LINE_HEADING);
const LINE_SMOOTHING_WEIGHTS = [1, 8, 28, 56, 70, 56, 28, 8, 1];
const LINE_WINDOW = (LINE_SMOOTHING_WEIGHTS.length - 1) / 2;

function laneLimits(roads: TrafficRoad[]) {
  const index = new SpatialIndex(roads.flatMap(({ points, closed, width }) =>
    pathSegments(points, closed).map(segment => ({ ...segment, width })),
  ));
  return (pose: TrafficPose, extraWidth = 0): readonly [number, number] | null => {
    const distance = (segment: Parameters<typeof segmentProjection>[2]) =>
      segmentProjection(pose.x, pose.z, segment).distanceSq;
    const nearest = index.nearest(pose.x, pose.z, distance);
    if (!nearest || distance(nearest) > (nearest.width / 2 + 1) ** 2) return null;
    const dx = nearest.b.x - nearest.a.x, dz = nearest.b.z - nearest.a.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) return null;
    const alignment = (dx * Math.cos(pose.heading) + dz * Math.sin(pose.heading)) / length;
    if (Math.abs(alignment) < 0.6) return null;
    const lateral = ((pose.z - nearest.a.z) * dx - (pose.x - nearest.a.x) * dz) / length;
    const half = Math.max(0, nearest.width / 2 - HALF_WIDTH - 0.15 - extraWidth);
    return [(-half - Math.sign(alignment) * lateral) / Math.abs(alignment),
      (half - Math.sign(alignment) * lateral) / Math.abs(alignment)];
  };
}

export class TrafficTimeline {
  constructor(private readonly duration: number, private readonly posesByDriver: Map<number, Float32Array>) {}

  poseAt(driverNumber: number, at: number): TrafficPose | null {
    const now = MathUtils.clamp(at, 0, this.duration);
    const index = Math.floor(now / STEP_MS);
    const time = index * STEP_MS;
    const u = MathUtils.clamp((now - time) / Math.max(1, Math.min(STEP_MS, this.duration - time)), 0, 1);
    const poses = this.posesByDriver.get(driverNumber);
    if (!poses) return null;
    const from = index * POSE_SIZE;
    const to = u === 0 ? from : Math.min(from + POSE_SIZE, poses.length - POSE_SIZE);
    if (!Number.isFinite(poses[from]) || !Number.isFinite(poses[to])) return null;
    const value = (axis: number) => MathUtils.lerp(poses[from + axis], poses[to + axis], u);
    return { x: value(0), y: value(1), z: value(2), pitch: value(4),
      heading: poses[from + 3] + angleDelta(poses[from + 3], poses[to + 3]) * u };
  }

  sample(frame: ReplayFrame): BaseCarPlacement[] {
    return frame.cars.flatMap(car => {
      const pose = this.poseAt(car.driver.driverNumber, frame.now);
      return pose ? [{ car: { ...car, pitch: pose.pitch }, position: new Vector3(pose.x, pose.y, pose.z), heading: pose.heading }] : [];
    });
  }
}

export function* buildTrafficTimelineSteps(
  duration: number,
  placeAt: (time: number) => TrafficPlacement[],
  roads: TrafficRoad[],
  resetPlacement: () => void = () => {},
): Generator<number, TrafficTimeline> {
  const limits = laneLimits(roads);
  const primary = yield* planTraffic(duration, placeAt, limits, "adaptive", 0, 0.8);
  let selected = primary;
  if (primary.drift > 0.1) {
    resetPlacement();
    const steady = yield* planTraffic(duration, placeAt, limits, "steady", 0.8, 0.2);
    if (steady.drift < primary.drift) selected = steady;
  }
  for (const [driver, offsets] of selected.offsetsByDriver) {
    applyLineOffsets(selected.posesByDriver.get(driver)!, offsets, duration);
  }
  return new TrafficTimeline(duration, selected.posesByDriver);
}

function limitOffset(offset: number, neighbor: number, maxStep: number): number {
  const limit = neighbor * offset < 0 ? maxStep / 2 : Math.abs(neighbor) + maxStep;
  return Math.sign(offset) * Math.min(Math.abs(offset), limit);
}

function limitLineSteps(values: Float32Array, steps: Float32Array) {
  const last = values.length - 1;
  for (let i = last - 1; i >= 0; i--) {
    values[i] = limitOffset(values[i], values[i + 1], steps[i + 1]);
  }
  for (let i = 1; i <= last; i++) {
    values[i] = limitOffset(values[i], values[i - 1], steps[i]);
  }
}

function lineHeadingCorrection(poses: Float32Array, offsets: Float32Array, index: number): number {
  const before = Math.max(0, index - LINE_WINDOW);
  const after = Math.min(offsets.length - 1, index + LINE_WINDOW);
  const from = before * POSE_SIZE, to = after * POSE_SIZE;
  const dx = poses[to] - poses[from], dz = poses[to + 2] - poses[from + 2];
  if (!(dx * dx + dz * dz > 1e-6)) return 0;

  const headingBefore = poses[from + 3], headingAfter = poses[to + 3];
  const shiftedX = dx - Math.sin(headingAfter) * offsets[after] + Math.sin(headingBefore) * offsets[before];
  const shiftedZ = dz + Math.cos(headingAfter) * offsets[after] - Math.cos(headingBefore) * offsets[before];
  const correction = Math.atan2(dx * shiftedZ - dz * shiftedX, dx * shiftedX + dz * shiftedZ);
  return MathUtils.clamp(correction, -MAX_LINE_HEADING, MAX_LINE_HEADING);
}

function applyLineOffsets(poses: Float32Array, offsets: Float32Array, duration: number) {
  const last = offsets.length - 1;
  const lastStepSeconds = (duration - (last - 1) * STEP_MS) / 1000;
  const steps = new Float32Array(offsets.length);
  for (let i = 1; i <= last; i++) {
    const before = (i - 1) * POSE_SIZE, after = i * POSE_SIZE;
    const heading = poses[after + 3];
    const advance = (poses[after] - poses[before]) * Math.cos(heading)
      + (poses[after + 2] - poses[before + 2]) * Math.sin(heading);
    const seconds = i === last ? lastStepSeconds : STEP_MS / 1000;
    if (advance > 0) steps[i] = Math.min(MAX_LINE_SPEED * seconds, advance * MAX_LINE_SLOPE);
  }

  const limited = offsets.slice();
  limitLineSteps(limited, steps);
  for (let i = 1; i <= last; i++) {
    const allowed = offsets[i];
    if (allowed === 0) continue;
    let smooth = 0;
    for (const [tap, weight] of LINE_SMOOTHING_WEIGHTS.entries()) {
      const index = MathUtils.clamp(i + tap - LINE_WINDOW, 0, last);
      smooth += limited[index] * weight;
    }
    offsets[i] = MathUtils.clamp(smooth / 256, Math.min(0, allowed), Math.max(0, allowed));
  }
  limitLineSteps(offsets, steps);

  const headings = new Float32Array(offsets.length);
  for (let i = 0; i <= last; i++) {
    if (offsets[i] !== 0) headings[i] = lineHeadingCorrection(poses, offsets, i);
  }
  steps.fill(MAX_LINE_YAW_RATE * STEP_MS / 1000);
  steps[last] = MAX_LINE_YAW_RATE * lastStepSeconds;
  limitLineSteps(headings, steps);

  for (let i = 1; i <= last; i++) {
    const offset = offsets[i];
    if (offset === 0) continue;
    const sample = i * POSE_SIZE;
    poses[sample] -= Math.sin(poses[sample + 3]) * offset;
    poses[sample + 2] += Math.cos(poses[sample + 3]) * offset;
    poses[sample + 3] += headings[i];
  }
}

function* planTraffic(
  duration: number,
  placeAt: (time: number) => TrafficPlacement[],
  limits: ReturnType<typeof laneLimits>,
  pace: TrafficPace,
  progressStart: number,
  progressSpan: number,
) {
  const count = Math.ceil(duration / STEP_MS) + 1;
  const posesByDriver = new Map<number, Float32Array>();
  const offsetsByDriver = new Map<number, Float32Array>();
  const planner = new TrafficPlanner(pose => limits(pose) ?? [-2.5, 2.5], pace);
  const lineVariation = new TrafficLineVariation(pose => limits(pose, CAR_FOOTPRINT_RADIUS * LINE_HEADING_CHORD));
  let previous: TrafficLineFrame | undefined;
  let pending: TrafficLineFrame | undefined;
  let drift = 0, samplesCount = 0;
  const writeFrame = (index: number, frame: TrafficLineFrame, next?: TrafficLineFrame) => {
    const offsets = lineVariation.sample(frame, previous, next);
    for (const [id, offset] of offsets) {
      let samples = offsetsByDriver.get(id);
      if (!samples) {
        samples = new Float32Array(count);
        offsetsByDriver.set(id, samples);
      }
      samples[index] = offset;
    }
    for (const target of frame.targets) {
      const { id } = target;
      const pose = frame.poses.get(id)!;
      const dx = pose.x - target.x, dz = pose.z - target.z;
      if (!(Math.abs(dx) <= 5 && Math.abs(dz) <= 5)) {
        drift += Math.max(0, Math.hypot(dx, dz) - 10);
      }
      samplesCount++;
      let samples = posesByDriver.get(id);
      if (!samples) {
        samples = new Float32Array(count * POSE_SIZE).fill(NaN);
        posesByDriver.set(id, samples);
      }
      const offset = index * POSE_SIZE;
      samples[offset] = pose.x;
      samples[offset + 1] = pose.y;
      samples[offset + 2] = pose.z;
      samples[offset + 3] = pose.heading;
      samples[offset + 4] = pose.pitch;
    }
  };
  for (let i = 0; i < count; i++) {
    const time = Math.min(duration, i * STEP_MS);
    const targets = placeAt(time).map(({ car, position, heading, allowLineVariation }) => ({
      id: car.driver.driverNumber, x: position.x, y: position.y, z: position.z, heading, pitch: car.pitch, allowLineVariation,
    }));
    const poses = planner.step(targets, (time - (pending?.time ?? 0)) / 1000);
    const next = { time, targets, poses };
    if (pending) writeFrame(i - 1, pending, next);
    previous = pending;
    pending = next;
    if (i % 250 === 0) yield progressStart + progressSpan * i / count;
  }
  if (pending) writeFrame(count - 1, pending);
  return { posesByDriver, offsetsByDriver, drift: drift / Math.max(1, samplesCount) };
}
