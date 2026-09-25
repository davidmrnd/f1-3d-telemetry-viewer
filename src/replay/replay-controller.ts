import { resolveCarOrientation } from "./car-heading";
import type {
  CarSample,
  DriverInfo,
  FrameCarState,
  ReplayEvent,
  ReplayFrame,
  ReplaySegment,
} from "../types";

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function interpolateSample(a: CarSample, b: CarSample, ratio: number): CarSample {
  return {
    ...a,
    t: lerp(a.t, b.t, ratio),
    x: lerp(a.x, b.x, ratio),
    y: lerp(a.y, b.y, ratio),
    z: lerp(a.z, b.z, ratio),
    speed: lerp(a.speed, b.speed, ratio),
    throttle: lerp(a.throttle, b.throttle, ratio),
    brake: lerp(a.brake, b.brake, ratio),
    rpm: lerp(a.rpm, b.rpm, ratio),
    gapToLeader:
      a.gapToLeader != null && b.gapToLeader != null ? lerp(a.gapToLeader, b.gapToLeader, ratio) : a.gapToLeader,
    intervalToAhead:
      a.intervalToAhead != null && b.intervalToAhead != null
        ? lerp(a.intervalToAhead, b.intervalToAhead, ratio)
        : a.intervalToAhead,
    gear: ratio >= 0.5 ? b.gear : a.gear,
    drs: ratio >= 0.5 ? b.drs : a.drs,
    position: ratio >= 0.5 ? b.position : a.position,
  };
}

function findSamples(samples: CarSample[], t: number): {
  previous: CarSample;
  next: CarSample;
  previousIndex: number;
  nextIndex: number;
} {
  if (samples.length === 1) {
    return { previous: samples[0], next: samples[0], previousIndex: 0, nextIndex: 0 };
  }

  if (t <= samples[0].t) {
    const nextIndex = samples.length > 1 ? 1 : 0;
    return { previous: samples[0], next: samples[nextIndex], previousIndex: 0, nextIndex };
  }

  const lastIndex = samples.length - 1;
  if (t >= samples[lastIndex].t) {
    const previousIndex = lastIndex > 0 ? lastIndex - 1 : 0;
    return {
      previous: samples[previousIndex],
      next: samples[lastIndex],
      previousIndex,
      nextIndex: lastIndex,
    };
  }

  let low = 0;
  let high = samples.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].t < t) {
      low = middle + 1;
    } else if (samples[middle].t > t) {
      high = middle - 1;
    } else {
      return {
        previous: samples[middle],
        next: samples[middle],
        previousIndex: middle,
        nextIndex: middle,
      };
    }
  }

  const previousIndex = Math.max(0, low - 1);
  const nextIndex = Math.min(samples.length - 1, low);
  return {
    previous: samples[previousIndex],
    next: samples[nextIndex],
    previousIndex,
    nextIndex,
  };
}

function getActiveEvent(events: ReplayEvent[], t: number) {
  return events.find((event) => t >= event.startTime && t <= event.endTime) ?? null;
}

export class ReplayController {
  private readonly duration: number;
  private readonly samplesByDriver: Map<number, CarSample[]>;
  private readonly driversByNumber: Map<number, DriverInfo>;

  constructor(private readonly segment: ReplaySegment) {
    this.duration = segment.timeRange.end;
    this.samplesByDriver = new Map(
      Object.entries(segment.samples).map(([driverNumber, samples]) => [Number(driverNumber), samples]),
    );
    this.driversByNumber = new Map(segment.drivers.map((driver) => [driver.driverNumber, driver]));
  }

  getDuration() {
    return this.duration;
  }

  getSegment() {
    return this.segment;
  }

  getFrame(t: number): ReplayFrame {
    const clampedTime = Math.max(0, Math.min(this.duration, t));
    const cars: FrameCarState[] = [...this.samplesByDriver.entries()]
      .map(([driverNumber, samples]) => {
        const { previous, next, previousIndex, nextIndex } = findSamples(samples, clampedTime);
        const ratio =
          previous.t === next.t ? 0 : (clampedTime - previous.t) / Math.max(1, next.t - previous.t);
        const sample = interpolateSample(previous, next, ratio);
        const driver = this.driversByNumber.get(driverNumber);
        if (!driver) {
          return null;
        }

        return {
          driver,
          sample,
          ...resolveCarOrientation(samples, previousIndex, nextIndex, ratio),
        };
      })
      .filter(Boolean) as FrameCarState[];

    cars.sort((a, b) => {
      const positionA = a.sample.position ?? Number.MAX_SAFE_INTEGER;
      const positionB = b.sample.position ?? Number.MAX_SAFE_INTEGER;
      return positionA - positionB;
    });

    return {
      now: clampedTime,
      normalized: this.duration === 0 ? 0 : clampedTime / this.duration,
      cars,
      activeEvent: getActiveEvent(this.segment.events, clampedTime),
    };
  }
}
