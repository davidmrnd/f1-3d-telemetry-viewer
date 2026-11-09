import * as THREE from "three";
import type { CarSample, ReplaySegment } from "../types";
import type { BaseCarPlacement, DriverGridHolds } from "./car-placement";
import { sampleSpeedAt } from "./car-placement";
import type { StartingGridPose, StartingGridTrack } from "./starting-grid";
import { metersToScene, type SceneTransform, vectorFromPoint } from "./track-geometry";

const APPROACH_MS = 11000;
const RELEASE_MS = 8000;
const GRID_STOP_RADIUS_METERS = 90;
const CAR_CLEARANCE_METERS = 0.02;

interface GridStop {
  arrival: number;
  departure: number;
  approach: { t: number; distance: number }[];
  travel: { t: number; distance: number }[];
}

function smoothWeight(u: number): number {
  return THREE.MathUtils.smootherstep(u, 0, 1);
}

function blendAngle(from: number, to: number, weight: number): number {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * weight;
}

function buildTravel(samples: CarSample[], start: number, end: number) {
  const times = [start, ...samples.filter((sample) => sample.t > start && sample.t < end).map((sample) => sample.t), end];
  let distance = 0;
  let previousSpeed = sampleSpeedAt(samples, start) ?? 0;
  return times.map((t, index) => {
    const speed = Math.max(0, sampleSpeedAt(samples, t) ?? 0);
    if (index) distance += (previousSpeed + speed) / 2 / 3.6 * (t - times[index - 1]) / 1000;
    previousSpeed = speed;
    return { t, distance };
  });
}

function travelAt(travel: GridStop["travel"], now: number): number {
  let lo = 0;
  let hi = travel.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (travel[mid].t <= now) lo = mid;
    else hi = mid;
  }
  const a = travel[lo], b = travel[hi];
  return THREE.MathUtils.lerp(a.distance, b.distance, (now - a.t) / Math.max(1, b.t - a.t));
}

export class StartingGridPlacement {
  private readonly stops = new Map<number, GridStop[]>();

  constructor(
    segment: ReplaySegment,
    private readonly poses: Map<number, StartingGridPose>,
    holds: DriverGridHolds,
    greenAt: number | null,
    private readonly track: StartingGridTrack,
    private readonly transform: SceneTransform,
  ) {
    if (greenAt === null) return;
    for (const [driverNumber, pose] of poses) {
      const samples = segment.samples[driverNumber] ?? [];
      const stops: GridStop[] = [];
      for (const hold of holds.get(driverNumber) ?? []) {
        if (hold.start >= greenAt || samples.length === 0) continue;
        const departure = hold.end >= greenAt - 7500 ? greenAt : hold.end;
        const probeAt = Math.max(hold.start, Math.min(departure - 1000, hold.end));
        const sample = samples.reduce((best, sample) => Math.abs(sample.t - probeAt) < Math.abs(best.t - probeAt) ? sample : best);
        const point = vectorFromPoint(sample, transform);
        if (Math.hypot(point.x - pose.position.x, point.z - pose.position.z) > GRID_STOP_RADIUS_METERS) continue;
        stops.push({
          arrival: hold.start,
          departure,
          approach: buildTravel(samples, hold.start - APPROACH_MS, hold.start),
          travel: buildTravel(samples, departure, departure + RELEASE_MS),
        });
      }
      this.stops.set(driverNumber, stops);
    }
  }

  apply(placements: BaseCarPlacement[], now: number): BaseCarPlacement[] {
    return placements.map((placement) => {
      const id = placement.car.driver.driverNumber;
      const pose = this.poses.get(id);
      const stops = this.stops.get(id);
      if (!pose || !stops) return placement;
      const stop = stops.find((stop, index) => now >= stop.arrival - APPROACH_MS && now < stop.departure + RELEASE_MS
        && (index === stops.length - 1 || now < stops[index + 1].arrival - APPROACH_MS));
      if (!stop) return placement;

      let guidedPose = pose;
      let weight = 1;
      if (now < stop.arrival) {
        const remaining = metersToScene(stop.approach.at(-1)!.distance - travelAt(stop.approach, now), this.transform);
        guidedPose = this.track.poseAt(pose.distance - remaining * this.track.direction, pose.offset);
        weight = smoothWeight((now - stop.arrival + APPROACH_MS) / (APPROACH_MS / 2));
      } else if (now >= stop.departure) {
        const distance = metersToScene(travelAt(stop.travel, now), this.transform);
        guidedPose = this.track.poseAt(pose.distance + distance * this.track.direction, pose.offset);
        weight = 1 - smoothWeight((now - stop.departure) / RELEASE_MS);
      }
      if (weight <= 0) return placement;
      const position = guidedPose.position.clone();
      position.y += CAR_CLEARANCE_METERS;
      position.lerp(placement.position, 1 - weight);
      return {
        ...placement,
        position,
        heading: blendAngle(placement.heading, guidedPose.heading, weight),
        car: { ...placement.car, pitch: blendAngle(placement.car.pitch, guidedPose.pitch, weight) },
      };
    });
  }
}
