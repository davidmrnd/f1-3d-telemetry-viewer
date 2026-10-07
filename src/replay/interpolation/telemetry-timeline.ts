import type { CarSample } from "../../types";
import { intervalIndexAt } from "./sorted-search";

function lerp(from: number, to: number, ratio: number): number {
  return from + (to - from) * ratio;
}

function lerpNullable(from: number | null, to: number | null, ratio: number): number | null {
  return from !== null && to !== null ? lerp(from, to, ratio) : from;
}

function blendSamples(previous: CarSample, next: CarSample, ratio: number, t: number): CarSample {
  const nearest = ratio >= 0.5 ? next : previous;
  return {
    ...previous,
    t,
    speed: lerp(previous.speed, next.speed, ratio),
    throttle: lerp(previous.throttle, next.throttle, ratio),
    brake: lerp(previous.brake, next.brake, ratio),
    rpm: lerp(previous.rpm, next.rpm, ratio),
    gapToLeader: lerpNullable(previous.gapToLeader, next.gapToLeader, ratio),
    intervalToAhead: lerpNullable(previous.intervalToAhead, next.intervalToAhead, ratio),
    gear: nearest.gear,
    drs: nearest.drs,
    position: nearest.position,
  };
}

export class TelemetryTimeline {
  private readonly times: Float64Array;

  constructor(private readonly samples: CarSample[]) {
    this.times = Float64Array.from(samples, (sample) => sample.t);
  }

  sampleAt(t: number): CarSample {
    const { samples, times } = this;
    const last = samples.length - 1;
    if (last === 0 || t <= times[0]) {
      return { ...samples[0], t };
    }
    if (t >= times[last]) {
      return { ...samples[last], t };
    }

    const index = intervalIndexAt(times, t);
    const span = times[index + 1] - times[index];
    const ratio = span > 0 ? (t - times[index]) / span : 0;
    return blendSamples(samples[index], samples[index + 1], ratio, t);
  }
}
