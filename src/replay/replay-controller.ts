import { buildDriverTrajectories } from "./interpolation/build-driver-trajectories";
import type { DriverTrajectory } from "./interpolation/driver-trajectory";
import { TelemetryTimeline } from "./interpolation/telemetry-timeline";
import { buildLaneOffsetTimelines } from "./overtakes/detect-side-by-side";
import type { LaneOffsetTimeline } from "./overtakes/lane-offset-timeline";
import type {
  DriverInfo,
  FrameCarState,
  ReplayEvent,
  ReplayFrame,
  ReplaySegment,
  TrackStatusInterval,
} from "../types";

const LANE_CHANGE_MIN_SPEED_MPS = 5;

interface DriverTrack {
  driver: DriverInfo;
  trajectory: DriverTrajectory;
  laneOffset: LaneOffsetTimeline;
  telemetry: TelemetryTimeline;
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
  private readonly duration: number;
  private readonly tracks: DriverTrack[];

  constructor(private readonly segment: ReplaySegment) {
    this.duration = segment.timeRange.end;
    const driversByNumber = new Map(segment.drivers.map((driver) => [driver.driverNumber, driver]));
    const trajectories = buildDriverTrajectories(segment);
    const laneOffsets = buildLaneOffsetTimelines(trajectories, this.duration);
    this.tracks = [...trajectories].flatMap(([driverNumber, trajectory]) => {
      const driver = driversByNumber.get(driverNumber);
      const samples = segment.samples[driverNumber];
      const laneOffset = laneOffsets.get(driverNumber);
      if (!driver || !samples || samples.length === 0 || !laneOffset) {
        return [];
      }
      return [{ driver, trajectory, laneOffset, telemetry: new TelemetryTimeline(samples) }];
    });
  }

  getDuration() {
    return this.duration;
  }

  getSegment() {
    return this.segment;
  }

  getFrame(t: number): ReplayFrame {
    const clampedTime = Math.max(0, Math.min(this.duration, t));
    const cars: FrameCarState[] = this.tracks.map(({ driver, trajectory, laneOffset, telemetry }) => {
      const pose = trajectory.poseAt(clampedTime);
      const lane = laneOffset.sample(clampedTime);
      return {
        driver,
        sample: { ...telemetry.sampleAt(clampedTime), x: pose.x, y: pose.y, z: pose.z },
        heading: pose.heading + Math.atan2(lane.rate, Math.max(pose.speed, LANE_CHANGE_MIN_SPEED_MPS)),
        pitch: pose.pitch,
        lateralOffset: lane.offset,
      };
    });

    cars.sort((a, b) => {
      const positionA = a.sample.position ?? Number.MAX_SAFE_INTEGER;
      const positionB = b.sample.position ?? Number.MAX_SAFE_INTEGER;
      return positionA - positionB;
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
