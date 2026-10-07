import type { LocationFix } from "./location-fixes";
import type { TelemetrySpeedProfile, TimeInterval } from "./telemetry-speed-profile";
import { kmhToMetersPerSecond, msToSeconds } from "./units";

export const DISTANCE_COMPONENT = 0;
export const SPEED_COMPONENT = 1;
export const ACCELERATION_COMPONENT = 2;

export type ProgressComponent = typeof DISTANCE_COMPONENT | typeof SPEED_COMPONENT | typeof ACCELERATION_COMPONENT;

const POSITION_NOISE_METERS = 1;
const SPEED_NOISE_MPS = 0.6;
const STOPPED_SPEED_NOISE_MPS = 0.01;
const STOPPED_ACCELERATION_NOISE_MPS2 = 0.1;
const BACKWARD_FIX_TOLERANCE_METERS = 0.5;
const MOVING_SPEED_MPS = kmhToMetersPerSecond(5);
const GAP_PRIOR_MIN_MS = 400;
const GAP_PRIOR_STEP_MS = 100;
const GAP_ACCELERATION_SPREAD_MPS2 = 4;

export interface ProgressMeasurement {
  t: number;
  component: ProgressComponent;
  value: number;
  variance: number;
  robust: boolean;
}

export interface ProgressMeasurementInput {
  fixes: LocationFix[];
  fixArcLengths: Float64Array;
  telemetry: TelemetrySpeedProfile;
  lagMs: number;
  speedScale: number;
  timingJitterSeconds: number;
}

function addDistanceMeasurements(input: ProgressMeasurementInput, measurements: ProgressMeasurement[]): void {
  const { fixes, fixArcLengths, telemetry, lagMs, speedScale, timingJitterSeconds } = input;
  let furthest = Number.NEGATIVE_INFINITY;

  fixes.forEach((fix, index) => {
    const distance = fixArcLengths[index];
    const speed = speedScale * telemetry.speedAt(fix.t + lagMs);
    if (speed > MOVING_SPEED_MPS && distance < furthest - BACKWARD_FIX_TOLERANCE_METERS) {
      return;
    }

    furthest = Math.max(furthest, distance);
    const timingNoise = speed * timingJitterSeconds;
    measurements.push({
      t: fix.t,
      component: DISTANCE_COMPONENT,
      value: distance,
      variance: POSITION_NOISE_METERS * POSITION_NOISE_METERS + timingNoise * timingNoise,
      robust: true,
    });
  });
}

function addSpeedMeasurements(input: ProgressMeasurementInput, measurements: ProgressMeasurement[]): void {
  const { telemetry, lagMs, speedScale, timingJitterSeconds } = input;

  for (let index = 0; index < telemetry.count; index += 1) {
    const t = telemetry.times[index] - lagMs;
    if (telemetry.isStoppedReading(index)) {
      measurements.push({
        t,
        component: SPEED_COMPONENT,
        value: 0,
        variance: STOPPED_SPEED_NOISE_MPS * STOPPED_SPEED_NOISE_MPS,
        robust: false,
      });
      measurements.push({
        t,
        component: ACCELERATION_COMPONENT,
        value: 0,
        variance: STOPPED_ACCELERATION_NOISE_MPS2 * STOPPED_ACCELERATION_NOISE_MPS2,
        robust: false,
      });
      continue;
    }

    const timingNoise = speedScale * telemetry.slopeAround(index) * timingJitterSeconds;
    measurements.push({
      t,
      component: SPEED_COMPONENT,
      value: speedScale * telemetry.speeds[index],
      variance: SPEED_NOISE_MPS * SPEED_NOISE_MPS + timingNoise * timingNoise,
      robust: true,
    });
  }
}

function addGapSpeedPriors(input: ProgressMeasurementInput, measurements: ProgressMeasurement[]): void {
  const { telemetry, lagMs, speedScale } = input;

  for (let index = 1; index < telemetry.count; index += 1) {
    const start = telemetry.times[index - 1];
    const end = telemetry.times[index];
    const gap = end - start;
    if (gap < GAP_PRIOR_MIN_MS) {
      continue;
    }

    const steps = Math.ceil(gap / GAP_PRIOR_STEP_MS);
    for (let step = 1; step < steps; step += 1) {
      const t = start + (gap * step) / steps;
      const spread = GAP_ACCELERATION_SPREAD_MPS2 * msToSeconds(Math.min(t - start, end - t));
      measurements.push({
        t: t - lagMs,
        component: SPEED_COMPONENT,
        value: speedScale * telemetry.speedAt(t),
        variance: SPEED_NOISE_MPS * SPEED_NOISE_MPS + spread * spread,
        robust: true,
      });
    }
  }
}

export function buildProgressMeasurements(input: ProgressMeasurementInput): ProgressMeasurement[] {
  const measurements: ProgressMeasurement[] = [];
  addDistanceMeasurements(input, measurements);
  addSpeedMeasurements(input, measurements);
  addGapSpeedPriors(input, measurements);
  measurements.sort((a, b) => a.t - b.t);
  return measurements;
}

export function stationaryIntervals(telemetry: TelemetrySpeedProfile, lagMs: number): TimeInterval[] {
  return telemetry.stoppedIntervals().map((interval) => ({
    start: interval.start - lagMs,
    end: interval.end - lagMs,
  }));
}
