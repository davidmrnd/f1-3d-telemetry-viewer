import { MathUtils, Vector3 } from "three";
import type { ReplayFrame } from "../../types";
import type { BaseCarPlacement } from "../car-placement";
import { pathSegments, segmentProjection } from "../track/path";
import { SpatialIndex } from "../track/spatial";
import { angleDelta, HALF_WIDTH, type TrafficPose } from "./car-footprint";
import { TrafficPlanner, type TrafficPace } from "./traffic-planner";

export interface TrafficRoad {
  points: Vector3[];
  closed: boolean;
  width: number;
}

const STEP_MS = 50;
const POSE_SIZE = 5;

function laneLimits(roads: TrafficRoad[]) {
  const index = new SpatialIndex(roads.flatMap(({ points, closed, width }) =>
    pathSegments(points, closed).map(segment => ({ ...segment, width })),
  ));
  return (pose: TrafficPose): readonly [number, number] => {
    const distance = (segment: Parameters<typeof segmentProjection>[2]) =>
      segmentProjection(pose.x, pose.z, segment).distanceSq;
    const nearest = index.nearest(pose.x, pose.z, distance);
    if (!nearest || distance(nearest) > (nearest.width / 2 + 1) ** 2) return [-2.5, 2.5];
    const dx = nearest.b.x - nearest.a.x, dz = nearest.b.z - nearest.a.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) return [-2.5, 2.5];
    const alignment = (dx * Math.cos(pose.heading) + dz * Math.sin(pose.heading)) / length;
    if (Math.abs(alignment) < 0.6) return [-2.5, 2.5];
    const lateral = ((pose.z - nearest.a.z) * dx - (pose.x - nearest.a.x) * dz) / length;
    const half = Math.max(0, nearest.width / 2 - HALF_WIDTH - 0.15);
    return [(-half - Math.sign(alignment) * lateral) / Math.abs(alignment),
      (half - Math.sign(alignment) * lateral) / Math.abs(alignment)];
  };
}

export class TrafficTimeline {
  constructor(private readonly duration: number, private readonly posesByDriver: Map<number, Float32Array>) {}

  sample(frame: ReplayFrame): BaseCarPlacement[] {
    const index = Math.floor(frame.now / STEP_MS);
    const time = index * STEP_MS;
    const u = MathUtils.clamp((frame.now - time) / Math.max(1, Math.min(STEP_MS, this.duration - time)), 0, 1);
    return frame.cars.flatMap(car => {
      const poses = this.posesByDriver.get(car.driver.driverNumber);
      if (!poses) return [];
      const from = index * POSE_SIZE;
      const to = u === 0 ? from : Math.min(from + POSE_SIZE, poses.length - POSE_SIZE);
      if (!Number.isFinite(poses[from]) || !Number.isFinite(poses[to])) return [];
      const value = (axis: number) => MathUtils.lerp(poses[from + axis], poses[to + axis], u);
      const heading = poses[from + 3] + angleDelta(poses[from + 3], poses[to + 3]) * u;
      return [{ car: { ...car, pitch: value(4) }, position: new Vector3(value(0), value(1), value(2)), heading }];
    });
  }
}

export function* buildTrafficTimelineSteps(
  duration: number,
  placeAt: (time: number) => BaseCarPlacement[],
  roads: TrafficRoad[],
  resetPlacement: () => void = () => {},
): Generator<number, TrafficTimeline> {
  const limits = laneLimits(roads);
  const primary = yield* planTraffic(duration, placeAt, limits, "adaptive", 0, 0.8);
  if (primary.drift <= 0.1) return primary.timeline;
  resetPlacement();
  const steady = yield* planTraffic(duration, placeAt, limits, "steady", 0.8, 0.2);
  return steady.drift < primary.drift ? steady.timeline : primary.timeline;
}

function* planTraffic(
  duration: number,
  placeAt: (time: number) => BaseCarPlacement[],
  limits: ReturnType<typeof laneLimits>,
  pace: TrafficPace,
  progressStart: number,
  progressSpan: number,
) {
  const count = Math.ceil(duration / STEP_MS) + 1;
  const posesByDriver = new Map<number, Float32Array>();
  const planner = new TrafficPlanner(limits, pace);
  let previous = 0;
  let drift = 0, samplesCount = 0;
  for (let i = 0; i < count; i++) {
    const now = Math.min(duration, i * STEP_MS);
    const targets = placeAt(now).map(({ car, position, heading }) => ({
      id: car.driver.driverNumber, x: position.x, y: position.y, z: position.z, heading, pitch: car.pitch,
    }));
    const poses = planner.step(targets, (now - previous) / 1000);
    previous = now;
    for (const target of targets) {
      const { id } = target;
      const pose = poses.get(id)!;
      drift += Math.max(0, Math.hypot(pose.x - target.x, pose.z - target.z) - 10);
      samplesCount++;
      let samples = posesByDriver.get(id);
      if (!samples) {
        samples = new Float32Array(count * POSE_SIZE).fill(NaN);
        posesByDriver.set(id, samples);
      }
      const offset = i * POSE_SIZE;
      samples[offset] = pose.x;
      samples[offset + 1] = pose.y;
      samples[offset + 2] = pose.z;
      samples[offset + 3] = pose.heading;
      samples[offset + 4] = pose.pitch;
    }
    if (i % 250 === 0) yield progressStart + progressSpan * i / count;
  }
  return { timeline: new TrafficTimeline(duration, posesByDriver), drift: drift / Math.max(1, samplesCount) };
}
