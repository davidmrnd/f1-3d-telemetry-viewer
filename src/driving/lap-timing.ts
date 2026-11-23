import type { LapGate, TrackPoint3D } from "../types";

export function crossingFraction(from: TrackPoint3D, to: TrackPoint3D, gate: LapGate, tolerance = 0): number | null {
  const { origin, heading, halfWidth } = gate;
  const forwardX = Math.cos(heading);
  const forwardZ = Math.sin(heading);
  const before = (from.x - origin.x) * forwardX + (from.z - origin.z) * forwardZ;
  const after = (to.x - origin.x) * forwardX + (to.z - origin.z) * forwardZ;
  if (before >= 0 || after < 0 || after <= before) return null;
  const fraction = -before / (after - before);
  const x = from.x + (to.x - from.x) * fraction - origin.x;
  const z = from.z + (to.z - from.z) * fraction - origin.z;
  const y = from.y + (to.y - from.y) * fraction - origin.y;
  return Math.abs(z * forwardX - x * forwardZ) <= halfWidth + tolerance && Math.abs(y) <= 5 ? fraction : null;
}

export function findGateTime(
  gate: LapGate, pointAt: (time: number) => TrackPoint3D, start: number, end: number, near?: number,
): number | null {
  let best: number | null = null;
  let previous = pointAt(start);
  for (let time = start; time < end;) {
    const next = Math.min(end, time + 100);
    const point = pointAt(next);
    const ratio = crossingFraction(previous, point, gate, 9);
    if (ratio !== null) {
      const hit = time + (next - time) * ratio;
      if (near === undefined) return hit;
      if (best === null || Math.abs(near - hit) < Math.abs(near - best)) best = hit;
    }
    previous = point;
    time = next;
  }
  return best;
}

export class LapTiming {
  passed = 0;
  offTrackMs = 0;
  valid = true;
  deltaMs: number | null = null;
  finishMs: number | null = null;

  constructor(readonly gates: LapGate[], private readonly referenceTimes: (number | null)[]) {}

  advance(from: TrackPoint3D, to: TrackPoint3D, elapsedMs: number, stepMs: number, mainTrack: boolean) {
    if (this.finishMs !== null) return;
    this.offTrackMs = mainTrack ? 0 : this.offTrackMs + stepMs;
    if (this.offTrackMs >= 500) this.valid = false;
    const fraction = crossingFraction(from, to, this.gates[this.passed], 2);
    if (fraction === null) return;
    const time = elapsedMs + fraction * stepMs;
    const reference = this.referenceTimes[this.passed];
    if (reference != null) this.deltaMs = time - reference;
    this.passed++;
    if (this.passed === this.gates.length) this.finishMs = time;
  }
}
