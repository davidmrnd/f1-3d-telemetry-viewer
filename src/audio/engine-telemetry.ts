import type { CarSample } from "../types";

const RPM_PER_KMH = [0, 113, 88, 74, 63, 53, 46, 40, 36];
const IDLE_RPM = 3700;
const MAX_RPM = 13500;
const RECORDED_RPM_WEIGHT = 0.3;

export interface EngineTarget {
  rpmTarget: number;
  throttle: number;
  brake: number;
  gear: number;
}

export type EngineCommand = (Omit<EngineTarget, "gear"> & {
  shift: number;
  reset: boolean;
}) | null;

function pedal(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value / 100)) : 0;
}

function clampRpm(rpm: number) {
  return Math.max(IDLE_RPM, Math.min(MAX_RPM, rpm));
}

export function getEngineTarget(sample: CarSample, simulated = false): EngineTarget {
  const ratio = RPM_PER_KMH[sample.gear] ?? 0;
  const speed = Number.isFinite(sample.speed) ? Math.max(0, sample.speed) : 0;
  const throttle = pedal(sample.throttle);
  const brake = pedal(sample.brake);
  if (simulated && Number.isFinite(sample.rpm)) {
    return { rpmTarget: clampRpm(sample.rpm), throttle, brake, gear: sample.gear };
  }
  const freeRpm = IDLE_RPM + throttle * 7200;
  const clutchSlip = ratio === 0 ? 1 : Math.max(0, 1 - speed / 55);
  const gearedRpm = clampRpm(speed * ratio);
  const rpmSynth = gearedRpm + (freeRpm - gearedRpm) * clutchSlip;
  const recordedRpm = Number.isFinite(sample.rpm) && sample.rpm > 0 ? clampRpm(sample.rpm) : rpmSynth;
  return {
    rpmTarget: rpmSynth + (recordedRpm - rpmSynth) * RECORDED_RPM_WEIGHT,
    throttle,
    brake,
    gear: ratio ? sample.gear : 0,
  };
}
