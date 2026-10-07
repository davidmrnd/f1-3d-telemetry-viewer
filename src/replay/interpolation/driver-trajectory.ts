import { computeMovementHeading, computeMovementPitch } from "../car-heading";
import type { DrivingLine } from "./driving-line";
import type { ProgressCurve } from "./progress-curve";
import { metersToOpenF1Units } from "./units";

const HEADING_CHORD_METERS = 6;
const PITCH_CHORD_METERS = 10;

export interface TrajectoryCalibration {
  telemetryLagMs: number;
  speedScale: number;
  timingJitterSeconds: number;
}

export interface TrajectoryPose {
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  distance: number;
  speed: number;
}

export class DriverTrajectory {
  constructor(
    private readonly line: DrivingLine,
    private readonly progress: ProgressCurve,
    readonly calibration: TrajectoryCalibration,
  ) {}

  poseAt(t: number): TrajectoryPose {
    const { distance, speed } = this.progress.sample(t);
    const position = this.line.pointAt(distance);
    const heading = computeMovementHeading(
      this.line.pointAt(distance - HEADING_CHORD_METERS / 2),
      this.line.pointAt(distance + HEADING_CHORD_METERS / 2),
    );
    const pitch = computeMovementPitch(
      this.line.pointAt(distance - PITCH_CHORD_METERS / 2),
      this.line.pointAt(distance + PITCH_CHORD_METERS / 2),
    );

    return {
      x: metersToOpenF1Units(position.x),
      y: metersToOpenF1Units(position.y),
      z: metersToOpenF1Units(position.z),
      heading: heading ?? 0,
      pitch: pitch ?? 0,
      distance,
      speed,
    };
  }
}
