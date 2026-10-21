import type { CarSample, ReplaySegment } from "../../types";
import { DriverTrajectory } from "./driver-trajectory";
import { DrivingLine } from "./driving-line";
import { smoothProgress } from "./kalman-progress-smoother";
import { extractLocationFixes, type LocationFix } from "./location-fixes";
import { ProgressCurve } from "./progress-curve";
import { buildProgressMeasurements, stationaryIntervals } from "./progress-measurements";
import { estimateSpeedScale, estimateTelemetryLagMs, estimateTimingJitterSeconds } from "./stream-alignment";
import { TelemetrySpeedProfile } from "./telemetry-speed-profile";

interface PreparedDriver {
  fixes: LocationFix[];
  fixArcLengths: Float64Array;
  telemetry: TelemetrySpeedProfile;
  line: DrivingLine;
}

function prepareDriver(samples: CarSample[]): PreparedDriver {
  const fixes = extractLocationFixes(samples);
  const { line, fixArcLengths } = DrivingLine.fromFixes(fixes);
  return { fixes, fixArcLengths, telemetry: new TelemetrySpeedProfile(samples), line };
}

function buildTrajectory(driver: PreparedDriver, telemetryLagMs: number): DriverTrajectory {
  const speedScale = estimateSpeedScale(driver, telemetryLagMs);
  const timingJitterSeconds = estimateTimingJitterSeconds(driver, telemetryLagMs, speedScale);
  const measurements = buildProgressMeasurements({
    ...driver,
    lagMs: telemetryLagMs,
    speedScale,
    timingJitterSeconds,
  });
  const knots = smoothProgress(measurements, stationaryIntervals(driver.telemetry, telemetryLagMs));
  return new DriverTrajectory(driver.line, new ProgressCurve(knots), {
    telemetryLagMs,
    speedScale,
    timingJitterSeconds,
  });
}

export function* buildDriverTrajectoriesSteps(segment: ReplaySegment): Generator<number, Map<number, DriverTrajectory>> {
  const prepared = new Map<number, PreparedDriver>();
  const entries = Object.entries(segment.samples);
  for (const [index, [driverNumber, samples]] of entries.entries()) {
    if (samples.length > 0) {
      prepared.set(Number(driverNumber), prepareDriver(samples));
    }
    yield 0.3 * (index + 1) / entries.length;
  }

  const telemetryLagMs = estimateTelemetryLagMs([...prepared.values()]);
  const trajectories = new Map<number, DriverTrajectory>();
  let completed = 0;
  for (const [driverNumber, driver] of prepared) {
    trajectories.set(driverNumber, buildTrajectory(driver, telemetryLagMs));
    completed += 1;
    yield 0.3 + 0.7 * completed / prepared.size;
  }
  return trajectories;
}

export function buildDriverTrajectories(segment: ReplaySegment): Map<number, DriverTrajectory> {
  const steps = buildDriverTrajectoriesSteps(segment);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
