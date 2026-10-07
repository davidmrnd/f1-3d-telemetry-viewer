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

export function buildDriverTrajectories(segment: ReplaySegment): Map<number, DriverTrajectory> {
  const prepared = new Map<number, PreparedDriver>();
  for (const [driverNumber, samples] of Object.entries(segment.samples)) {
    if (samples.length > 0) {
      prepared.set(Number(driverNumber), prepareDriver(samples));
    }
  }

  const telemetryLagMs = estimateTelemetryLagMs([...prepared.values()]);
  const trajectories = new Map<number, DriverTrajectory>();
  for (const [driverNumber, driver] of prepared) {
    trajectories.set(driverNumber, buildTrajectory(driver, telemetryLagMs));
  }
  return trajectories;
}
