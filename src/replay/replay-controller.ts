import { buildDriverTrajectories, buildDriverTrajectoriesSteps } from "./interpolation/build-driver-trajectories";
import type { DriverTrajectory } from "./interpolation/driver-trajectory";
import { TelemetryTimeline } from "./interpolation/telemetry-timeline";
import { buildRaceMilestones } from "./events/race-milestones";
import type {
  DriverInfo,
  FrameCarState,
  ReplayEvent,
  ReplayFrame,
  ReplaySegment,
  Retirement,
  TrackStatusInterval,
} from "../types";

interface DriverTrack {
  driver: DriverInfo;
  trajectory: DriverTrajectory;
  telemetry: TelemetryTimeline;
  retirement: Retirement | undefined;
}

async function prepareSteps<T>(steps: Generator<number, T>, onProgress: (progress: number) => Promise<void>) {
  let step = steps.next();
  while (!step.done) {
    await onProgress(step.value);
    step = steps.next();
  }
  return step.value;
}

function getActiveEvent(events: ReplayEvent[], t: number) {
  return events.find((event) => t >= event.startTime && t <= event.endTime) ?? null;
}

function getActiveTrackStatus(intervals: TrackStatusInterval[], t: number): TrackStatusInterval | null {
  if (intervals.length === 0) {
    return null;
  }
  return (
    intervals.find((interval) => t >= interval.start && t < interval.end) ??
    intervals.find((interval) => t === interval.end) ??
    null
  );
}

export class ReplayController {
  readonly milestones;
  private readonly duration: number;
  private readonly tracks: DriverTrack[];

  constructor(private readonly segment: ReplaySegment, trajectories = buildDriverTrajectories(segment)) {
    this.milestones = buildRaceMilestones(segment);
    this.duration = segment.timeRange.end;
    const driversByNumber = new Map(segment.drivers.map((driver) => [driver.driverNumber, driver]));
    const retirements = new Map(segment.retirements?.map((retirement) => [retirement.driverNumber, retirement]));
    this.tracks = [...trajectories].flatMap(([driverNumber, trajectory]) => {
      const driver = driversByNumber.get(driverNumber);
      const samples = segment.samples[driverNumber];
      if (!driver || !samples || samples.length === 0) {
        return [];
      }
      return [{ driver, trajectory, telemetry: new TelemetryTimeline(samples), retirement: retirements.get(driverNumber) }];
    });
  }

  static async create(segment: ReplaySegment, onProgress: (progress: number) => Promise<void>) {
    const trajectories = await prepareSteps(
      buildDriverTrajectoriesSteps(segment),
      onProgress,
    );
    return new ReplayController(segment, trajectories);
  }

  getDuration() {
    return this.duration;
  }

  getSegment() {
    return this.segment;
  }

  getFrame(t: number): ReplayFrame {
    const clampedTime = Math.max(0, Math.min(this.duration, t));
    const cars: FrameCarState[] = this.tracks.map(({ driver, trajectory, telemetry, retirement }) => {
      const pose = trajectory.poseAt(clampedTime);
      const sample = telemetry.sampleAt(clampedTime);
      sample.x = pose.x;
      sample.y = pose.y;
      sample.z = pose.z;
      return {
        driver,
        sample,
        heading: pose.heading,
        pitch: pose.pitch,
        retirement: retirement && clampedTime >= retirement.t ? retirement.status : undefined,
      };
    });

    cars.sort((a, b) => {
      const retirementOrder = Number(Boolean(a.retirement)) - Number(Boolean(b.retirement));
      const positionA = a.sample.position ?? Number.MAX_SAFE_INTEGER;
      const positionB = b.sample.position ?? Number.MAX_SAFE_INTEGER;
      return retirementOrder || positionA - positionB;
    });

    return {
      now: clampedTime,
      normalized: this.duration === 0 ? 0 : clampedTime / this.duration,
      cars,
      activeEvent: getActiveEvent(this.segment.events, clampedTime),
      trackStatus: getActiveTrackStatus(this.segment.trackStatus ?? [], clampedTime),
    };
  }
}
