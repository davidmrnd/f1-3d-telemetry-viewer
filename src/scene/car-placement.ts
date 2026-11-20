import * as THREE from "three";
import type {
  FrameCarState,
  ReplayFrame,
  ReplaySegment,
  StartingGridSlot,
  TrackPhase,
  TrackStatusInterval,
} from "../types";
import { type SceneTransform, vectorFromPoint } from "./track-geometry";

const CAR_TRACK_CLEARANCE_METERS = 0.02;

const GRID_LATERAL_OFFSET_METERS = 2.8;
const GRID_PACK_SPEED_KMH = 5;
const GRID_HOLD_MIN_MS = 1500;
const GRID_HOLD_SCAN_STEP_MS = 100;
const GRID_APPROACH_MS = 11000;
const GRID_EXIT_MS = 2500;
const GRID_ARRIVAL_MAX_GAP_MS = 90000;
const GRID_LAUNCH_FULL_KMH = 40;
const GRID_LAUNCH_END_KMH = 160;
const GRID_OFFSET_SMOOTH_TAU_S = 0.15;
const GRID_SEEK_SNAP_MS = 750;
const GRID_STEER_MIN_SPEED_MPS = 4;
const KMH_TO_MPS = 1 / 3.6;

export interface BaseCarPlacement {
  car: FrameCarState;
  position: THREE.Vector3;
  heading: number;
}

export interface GridHoldInterval {
  start: number;
  end: number;
}

export type DriverGridHolds = Map<number, GridHoldInterval[]>;

export type VisualPlacementOptions = {
  offsets: Map<number, number>;
  rates: Map<number, number>;
};

function smootherstep(u: number): number {
  return u * u * u * (u * (u * 6 - 15) + 10);
}

function smootherstepSlope(u: number): number {
  return 30 * u * u * (1 - u) * (1 - u);
}

function speedBlendWeight(speedKmh: number, fullAtOrBelow: number, zeroAtOrAbove: number) {
  if (speedKmh <= fullAtOrBelow) {
    return 1;
  }
  if (speedKmh >= zeroAtOrAbove) {
    return 0;
  }
  const u = (zeroAtOrAbove - speedKmh) / (zeroAtOrAbove - fullAtOrBelow);
  return smootherstep(u);
}

function phaseAt(intervals: TrackStatusInterval[], t: number): TrackPhase | undefined {
  return (
    intervals.find((interval) => t >= interval.start && t < interval.end)?.phase ??
    intervals.find((interval) => t === interval.end)?.phase
  );
}

export function sampleSpeedAt(samples: { t: number; speed: number }[], t: number): number | null {
  if (samples.length === 0) {
    return null;
  }
  if (t <= samples[0].t) {
    return samples[0].speed;
  }
  const last = samples[samples.length - 1];
  if (t >= last.t) {
    return last.speed;
  }
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const a = samples[lo];
  const b = samples[hi];
  const u = (t - a.t) / Math.max(1, b.t - a.t);
  return a.speed + (b.speed - a.speed) * u;
}

function mergeIntervals(intervals: GridHoldInterval[]): GridHoldInterval[] {
  if (intervals.length === 0) {
    return [];
  }
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: GridHoldInterval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    if (current.start <= last.end + GRID_HOLD_SCAN_STEP_MS) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

function findStationaryIntervals(
  samples: { t: number; speed: number }[],
  trackStatus: TrackStatusInterval[],
  rangeStart: number,
  rangeEnd: number,
): GridHoldInterval[] {
  const holds: GridHoldInterval[] = [];
  let holdStart: number | null = null;

  for (let t = rangeStart; t <= rangeEnd; t += GRID_HOLD_SCAN_STEP_MS) {
    const phase = phaseAt(trackStatus, t);
    const eligible = phase === "formation" || phase === "pre_session" || phase === "standing_start";
    const speed = eligible ? sampleSpeedAt(samples, t) : null;
    const stationary = speed !== null && speed <= GRID_PACK_SPEED_KMH;

    if (stationary) {
      if (holdStart === null) {
        holdStart = t;
      }
    } else if (holdStart !== null) {
      if (t - holdStart >= GRID_HOLD_MIN_MS) {
        holds.push({ start: holdStart, end: t });
      }
      holdStart = null;
    }
  }

  if (holdStart !== null && rangeEnd - holdStart >= GRID_HOLD_MIN_MS) {
    holds.push({ start: holdStart, end: rangeEnd });
  }

  return holds;
}

function selectDriverGridHolds(
  stationary: GridHoldInterval[],
  standingStarts: GridHoldInterval[],
  trackStatus: TrackStatusInterval[],
  standingStartAt: number,
): GridHoldInterval[] {
  const selected: GridHoldInterval[] = standingStarts.map((hold) => ({ ...hold }));

  for (const hold of stationary) {
    const phase = phaseAt(trackStatus, hold.start);
    if (phase === "pre_session") {
      selected.push(hold);
    }
  }

  const formationStops = stationary.filter((hold) => {
    const phase = phaseAt(trackStatus, hold.start);
    return phase === "formation" && hold.start < standingStartAt;
  });

  if (formationStops.length > 0) {
    const arrival = formationStops[formationStops.length - 1];
    if (standingStartAt - arrival.start <= GRID_ARRIVAL_MAX_GAP_MS) {
      selected.push(arrival);
    }
    const departure = formationStops[0];
    if (departure !== arrival && departure.end < arrival.start) {
      selected.push(departure);
    }
  }

  return mergeIntervals(selected);
}

export function buildDriverGridHolds(segment: ReplaySegment): DriverGridHolds {
  const trackStatus = segment.trackStatus ?? [];
  const standingStarts = trackStatus
    .filter((interval) => interval.phase === "standing_start")
    .map((interval) => ({ start: interval.start, end: interval.end }));
  const standingStartAt = standingStarts[0]?.start ?? segment.timeRange.end;
  const holds = new Map<number, GridHoldInterval[]>();

  for (const [driverKey, samples] of Object.entries(segment.samples)) {
    if (samples.length === 0) {
      continue;
    }
    const driverNumber = Number(driverKey);
    const stationary = findStationaryIntervals(
      samples,
      trackStatus,
      segment.timeRange.start,
      segment.timeRange.end,
    );
    holds.set(
      driverNumber,
      selectDriverGridHolds(stationary, standingStarts, trackStatus, standingStartAt),
    );
  }

  return holds;
}

export function gridHoldWeight(now: number, holds: GridHoldInterval[]): number {
  return gridHoldSample(now, holds).weight;
}

function gridHoldSample(now: number, holds: GridHoldInterval[]): { weight: number; rate: number } {
  let weight = 0;
  let rate = 0;

  for (const hold of holds) {
    if (now >= hold.start && now < hold.end) {
      return { weight: 1, rate: 0 };
    }

    if (now >= hold.start - GRID_APPROACH_MS && now < hold.start) {
      const u = (now - (hold.start - GRID_APPROACH_MS)) / GRID_APPROACH_MS;
      const approachWeight = smootherstep(u);
      const approachRate = (smootherstepSlope(u) * 1000) / GRID_APPROACH_MS;
      if (approachWeight >= weight) {
        weight = approachWeight;
        rate = approachRate;
      }
    }

    if (now >= hold.end && now < hold.end + GRID_EXIT_MS) {
      const u = 1 - (now - hold.end) / GRID_EXIT_MS;
      const exitWeight = smootherstep(Math.min(1, Math.max(0, u)));
      const exitRate = -(smootherstepSlope(Math.min(1, Math.max(0, u))) * 1000) / GRID_EXIT_MS;
      if (exitWeight >= weight) {
        weight = exitWeight;
        rate = exitRate;
      }
    }
  }

  return { weight, rate };
}

export function buildGridLateralOffsets(startingGrid: StartingGridSlot[]) {
  const offsets = new Map<number, number>();
  for (const slot of startingGrid) {
    const side = slot.position % 2 === 1 ? 1 : -1;
    offsets.set(slot.driverNumber, side * GRID_LATERAL_OFFSET_METERS);
  }
  return offsets;
}

function desiredGridState(
  car: FrameCarState,
  now: number,
  phase: TrackPhase | undefined,
  gridOffsets: Map<number, number>,
  holds: GridHoldInterval[],
  launchHold: boolean,
): { offset: number; rate: number } {
  const gridOffset = gridOffsets.get(car.driver.driverNumber);
  if (gridOffset === undefined) {
    return { offset: 0, rate: 0 };
  }

  const sample = gridHoldSample(now, holds);
  let weight = sample.weight;
  let weightRate = sample.rate;

  if (phase === "racing" && launchHold) {
    const launchWeight = speedBlendWeight(
      car.sample.speed,
      GRID_LAUNCH_FULL_KMH,
      GRID_LAUNCH_END_KMH,
    );
    if (launchWeight > weight) {
      weight = launchWeight;
      weightRate = 0;
    }
  }

  return {
    offset: gridOffset * weight,
    rate: gridOffset * weightRate,
  };
}

export class GridLateralOffsetBlender {
  private current = new Map<number, number>();
  private lastNow: number | null = null;
  private launchHold = false;
  private holdsByDriver: DriverGridHolds = new Map();
  private readonly gridOffsets: Map<number, number>;

  constructor(startingGrid: StartingGridSlot[]) {
    this.gridOffsets = buildGridLateralOffsets(startingGrid);
  }

  reset(holdsByDriver: DriverGridHolds = new Map()) {
    this.current.clear();
    this.lastNow = null;
    this.launchHold = false;
    this.holdsByDriver = holdsByDriver;
  }

  resolve(frame: ReplayFrame): VisualPlacementOptions {
    const phase = frame.trackStatus?.phase;
    const now = frame.now;
    const seeked =
      this.lastNow !== null && Math.abs(now - this.lastNow) > GRID_SEEK_SNAP_MS;
    const dtSec =
      this.lastNow !== null && !seeked ? Math.max(0, (now - this.lastNow) / 1000) : 0;
    this.lastNow = now;

    const anyHeld = frame.cars.some((car) => {
      const holds = this.holdsByDriver.get(car.driver.driverNumber) ?? [];
      return gridHoldWeight(now, holds) >= 1;
    });

    if (phase === "standing_start" || anyHeld) {
      this.launchHold = true;
    } else if (phase !== "racing") {
      this.launchHold = false;
    } else if (
      this.launchHold &&
      frame.cars.every((car) => car.sample.speed >= GRID_LAUNCH_END_KMH)
    ) {
      this.launchHold = false;
    }

    const offsets = new Map<number, number>();
    const rates = new Map<number, number>();
    const alpha =
      dtSec > 0 ? 1 - Math.exp(-dtSec / GRID_OFFSET_SMOOTH_TAU_S) : 1;

    for (const car of frame.cars) {
      const id = car.driver.driverNumber;
      const holds = this.holdsByDriver.get(id) ?? [];
      const desired = desiredGridState(
        car,
        now,
        phase,
        this.gridOffsets,
        holds,
        this.launchHold,
      );
      const previous = this.current.get(id);

      let next: number;
      if (seeked || previous === undefined || dtSec === 0) {
        next = desired.offset;
      } else {
        next = previous + (desired.offset - previous) * alpha;
      }

      const finiteRate =
        previous !== undefined && dtSec > 0 ? (next - previous) / dtSec : desired.rate;
      const rate = Math.abs(desired.rate) > Math.abs(finiteRate) ? desired.rate : finiteRate;

      offsets.set(id, next);
      rates.set(id, rate);
      this.current.set(id, next);
    }

    return { offsets, rates };
  }
}

export function buildVisualPlacements(
  frame: ReplayFrame,
  transform: SceneTransform,
  { offsets, rates }: VisualPlacementOptions,
): BaseCarPlacement[] {
  return frame.cars.map(car => {
    const position = vectorFromPoint(car.sample, transform);
    position.y += CAR_TRACK_CLEARANCE_METERS;
    const offset = offsets.get(car.driver.driverNumber) ?? 0;
    const rate = rates.get(car.driver.driverNumber) ?? 0;
    const speedMps = Math.max(car.sample.speed * KMH_TO_MPS, GRID_STEER_MIN_SPEED_MPS);
    const heading = car.heading + Math.atan2(rate, speedMps);
    position.x += -Math.sin(car.heading) * offset;
    position.y += 0 * offset;
    position.z += Math.cos(car.heading) * offset;
    return { car, position, heading };
  });
}
