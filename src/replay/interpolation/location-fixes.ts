import type { CarSample } from "../../types";
import { openF1UnitsToMeters } from "./units";

const DERIVED_SAMPLE_TOLERANCE_UNITS = 0.01;
const STALE_REPEAT_MIN_SPEED_KMH = 5;

export interface LocationFix {
  t: number;
  x: number;
  y: number;
  z: number;
}

function isLinearlyDerived(samples: CarSample[], index: number): boolean {
  if (index <= 0 || index >= samples.length - 1) {
    return false;
  }

  const previous = samples[index - 1];
  const current = samples[index];
  const next = samples[index + 1];
  const span = next.t - previous.t;
  if (span <= 0) {
    return false;
  }

  const ratio = (current.t - previous.t) / span;
  const dx = previous.x + (next.x - previous.x) * ratio - current.x;
  const dy = previous.y + (next.y - previous.y) * ratio - current.y;
  const dz = previous.z + (next.z - previous.z) * ratio - current.z;
  return dx * dx + dy * dy + dz * dz <= DERIVED_SAMPLE_TOLERANCE_UNITS * DERIVED_SAMPLE_TOLERANCE_UNITS;
}

function sharesPosition(a: CarSample, b: CarSample): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

export function extractLocationFixes(samples: CarSample[]): LocationFix[] {
  const fixes: LocationFix[] = [];
  let lastKept: CarSample | null = null;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (isLinearlyDerived(samples, index)) {
      continue;
    }
    if (lastKept && sharesPosition(lastKept, sample) && sample.speed > STALE_REPEAT_MIN_SPEED_KMH) {
      continue;
    }

    lastKept = sample;
    fixes.push({
      t: sample.t,
      x: openF1UnitsToMeters(sample.x),
      y: openF1UnitsToMeters(sample.y),
      z: openF1UnitsToMeters(sample.z),
    });
  }

  return fixes;
}
