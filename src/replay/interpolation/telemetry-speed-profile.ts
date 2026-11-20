import type { CarSample } from "../../types";
import { intervalIndexAt } from "./sorted-search";
import { kmhToMetersPerSecond, msToSeconds } from "./units";

const STOPPED_READING_KMH = 0.5;
const MIN_STOPPED_READINGS = 2;

export interface TimeInterval {
  start: number;
  end: number;
}

export class TelemetrySpeedProfile {
  readonly times: Float64Array;
  readonly speeds: Float64Array;
  private readonly readingsKmh: Float64Array;
  private readonly cumulativeDistances: Float64Array;

  constructor(samples: CarSample[]) {
    const times: number[] = [];
    const readings: number[] = [];
    for (const sample of samples) {
      if (times.length > 0 && sample.t === times[times.length - 1]) {
        readings[readings.length - 1] = sample.speed;
        continue;
      }
      times.push(sample.t);
      readings.push(sample.speed);
    }

    this.times = Float64Array.from(times);
    this.readingsKmh = Float64Array.from(readings);
    this.speeds = Float64Array.from(readings, kmhToMetersPerSecond);
    this.cumulativeDistances = new Float64Array(times.length);
    for (let index = 1; index < times.length; index += 1) {
      const meanSpeed = (this.speeds[index - 1] + this.speeds[index]) / 2;
      this.cumulativeDistances[index] =
        this.cumulativeDistances[index - 1] + meanSpeed * msToSeconds(times[index] - times[index - 1]);
    }
  }

  get count(): number {
    return this.times.length;
  }

  speedAt(t: number): number {
    const count = this.times.length;
    if (count === 0) {
      return 0;
    }
    if (count === 1 || t <= this.times[0]) {
      return this.speeds[0];
    }
    if (t >= this.times[count - 1]) {
      return this.speeds[count - 1];
    }

    return this.speedInInterval(t, intervalIndexAt(this.times, t));
  }

  distanceBetween(from: number, to: number): number {
    return this.cumulativeDistanceAt(to) - this.cumulativeDistanceAt(from);
  }

  fillCumulativeDistances(sortedTimes: Float64Array, offset: number, distances: Float64Array): void {
    const lastInterval = this.times.length - 2;
    let interval = 0;
    for (let i = 0; i < sortedTimes.length; i += 1) {
      const t = sortedTimes[i] + offset;
      while (interval < lastInterval && this.times[interval + 1] <= t) {
        interval += 1;
      }
      distances[i] = this.cumulativeDistanceAt(t, interval);
    }
  }

  slopeAround(index: number): number {
    const before = Math.max(0, index - 1);
    const after = Math.min(this.times.length - 1, index + 1);
    if (after === before) {
      return 0;
    }
    return (this.speeds[after] - this.speeds[before]) / msToSeconds(this.times[after] - this.times[before]);
  }

  isStoppedReading(index: number): boolean {
    return this.readingsKmh[index] < STOPPED_READING_KMH;
  }

  stoppedIntervals(): TimeInterval[] {
    const intervals: TimeInterval[] = [];
    let runStart = -1;

    for (let index = 0; index <= this.times.length; index += 1) {
      const stopped = index < this.times.length && this.isStoppedReading(index);
      if (stopped && runStart < 0) {
        runStart = index;
      }
      if (!stopped && runStart >= 0) {
        if (index - runStart >= MIN_STOPPED_READINGS) {
          intervals.push({ start: this.times[runStart], end: this.times[index - 1] });
        }
        runStart = -1;
      }
    }

    return intervals;
  }

  private speedInInterval(t: number, index: number): number {
    const ratio = (t - this.times[index]) / (this.times[index + 1] - this.times[index]);
    return this.speeds[index] + (this.speeds[index + 1] - this.speeds[index]) * ratio;
  }

  private cumulativeDistanceAt(t: number, interval?: number): number {
    const count = this.times.length;
    if (count === 0) {
      return 0;
    }
    if (count === 1 || t <= this.times[0]) {
      return this.speeds[0] * msToSeconds(t - this.times[0]);
    }
    if (t >= this.times[count - 1]) {
      return this.cumulativeDistances[count - 1] + this.speeds[count - 1] * msToSeconds(t - this.times[count - 1]);
    }

    const index = interval ?? intervalIndexAt(this.times, t);
    const meanSpeed = (this.speeds[index] + this.speedInInterval(t, index)) / 2;
    return this.cumulativeDistances[index] + meanSpeed * msToSeconds(t - this.times[index]);
  }
}
