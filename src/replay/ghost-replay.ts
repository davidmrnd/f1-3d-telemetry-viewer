import type { FrameCarState, GhostCapture, GhostLap } from "../types";
import { buildDriverTrajectories } from "./interpolation/build-driver-trajectories";
import { TelemetryTimeline } from "./interpolation/telemetry-timeline";

export function createGhostReplay(capture: GhostCapture, lap: GhostLap) {
  const { driverNumber } = lap;
  const driver = capture.drivers.find(entry => entry.driverNumber === driverNumber);
  const samples = capture.samples[driverNumber];
  if (!driver || !samples?.length) throw new Error("La trayectoria de esta vuelta no está disponible.");
  const trajectory = buildDriverTrajectories({ samples: { [driverNumber]: samples } }).get(driverNumber)!;
  const telemetry = new TelemetryTimeline(samples);
  return {
    firstTime: samples[0].t,
    lastTime: samples.at(-1)!.t,
    sample(time: number): FrameCarState {
      const { x, y, z, heading, pitch } = trajectory.poseAt(time);
      return { driver, heading, pitch, sample: { ...telemetry.sampleAt(time), x, y, z } };
    },
  };
}
