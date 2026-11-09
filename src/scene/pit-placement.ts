import * as THREE from "three";
import type { CarSample, PitStop, ReplaySegment } from "../types";
import type { BaseCarPlacement } from "./car-placement";
import type { TrackPath } from "./cameras/automatic/track-path";
import { pathSegments, segmentProjection } from "./track/path";
import { SpatialIndex } from "./track/spatial";
import type { PitLane, createCircuitHeightSampler } from "./track/pit-lane";
import { vectorFromPoint, type SceneTransform } from "./track-geometry";

const CAR_CLEARANCE = 0.02;
const PIT_MATCH_GAP_MS = 2500;
const ENTRY_BLEND_MS = 1500;
const EXIT_BLEND_MS = 850;
const EXIT_HEIGHT_BLEND_MS = 3000;

type HeightSampler = ReturnType<typeof createCircuitHeightSampler>;

interface ProgressSample {
  t: number;
  distance: number;
}

interface PitVisit {
  start: number;
  entry: number;
  exit: number;
  end: number;
  progress: ProgressSample[];
  stop?: { start: number; end: number; offset: number };
}

interface ParkedCar {
  time: number;
  position: THREE.Vector3;
  heading: number;
  pitch: number;
}

function progressAt(samples: ProgressSample[], now: number): number {
  let low = 0;
  let high = samples.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >>> 1;
    if (samples[middle].t <= now) low = middle;
    else high = middle;
  }
  const before = samples[low];
  const after = samples[high];
  const fraction = THREE.MathUtils.clamp((now - before.t) / Math.max(1, after.t - before.t), 0, 1);
  return THREE.MathUtils.lerp(before.distance, after.distance, fraction);
}

function blendAngle(from: number, to: number, weight: number): number {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * weight;
}

function blendPose(placement: BaseCarPlacement, pose: Omit<ParkedCar, "time">, weight: number): BaseCarPlacement {
  return {
    ...placement,
    position: placement.position.clone().lerp(pose.position, weight),
    heading: blendAngle(placement.heading, pose.heading, weight),
    car: { ...placement.car, pitch: blendAngle(placement.car.pitch, pose.pitch, weight) },
  };
}

export class PitLanePlacement {
  private readonly visits = new Map<number, PitVisit[]>();
  private readonly parked = new Map<number, ParkedCar>();
  private readonly absent = new Set<number>();
  private readonly road: SpatialIndex<ReturnType<typeof pathSegments>[number]>;

  constructor(
    segment: ReplaySegment,
    private readonly lane: PitLane | null,
    main: TrackPath,
    private readonly trackWidth: number,
    private readonly transform: SceneTransform,
    private readonly circuitHeight: HeightSampler,
  ) {
    this.road = new SpatialIndex(pathSegments([...main.points], false));
    if (lane) {
      const bounds = new THREE.Box3().setFromPoints([...lane.path.points]).expandByScalar(10);
      const raceStart = segment.trackStatus.find((status) => status.phase === "racing")?.start ?? 0;
      const stopsByDriver = new Map<number, PitStop[]>();
      for (const stop of segment.pitStops ?? []) {
        const stops = stopsByDriver.get(stop.driverNumber) ?? [];
        stops.push(stop);
        stopsByDriver.set(stop.driverNumber, stops);
      }
      for (const driver of segment.drivers) {
        const number = driver.driverNumber;
        const samples = segment.samples[number] ?? [];
        const retirement = segment.retirements?.find((item) => item.driverNumber === number && item.status === "dnf");
        const visits = this.findVisits(lane, samples, stopsByDriver.get(number) ?? [], bounds,
          raceStart, segment.timeRange.end, retirement?.t);
        if (visits.length) this.visits.set(number, visits);
      }
    }

    for (const retirement of segment.retirements ?? []) {
      if (retirement.status === "dns") {
        this.absent.add(retirement.driverNumber);
        continue;
      }
      const samples = segment.samples[retirement.driverNumber] ?? [];
      const lastMoving = samples.findIndex((sample) => sample.t >= retirement.t);
      const index = lastMoving < 0 ? samples.length - 1 : lastMoving;
      if (index < 0) continue;
      const stopped = samples.slice(index).find((sample) => sample.t <= retirement.t + 10000 && sample.speed <= 5);
      const sample = stopped ?? samples[index];
      const time = Math.max(retirement.t, sample.t);
      const position = vectorFromPoint(sample, this.transform);
      const pit = this.pitProgress(position);
      if (pit !== null && lane) {
        const offset = this.parkingOffset(lane, pit);
        this.parked.set(retirement.driverNumber, { ...this.lanePose(lane, pit, offset), time });
        continue;
      }
      let before = index - 1;
      while (before >= 0 && Math.hypot(sample.x - samples[before].x, sample.z - samples[before].z) < 15) before--;
      const previous = vectorFromPoint(samples[Math.max(0, before)], this.transform);
      position.y = this.circuitHeight(position.x, position.z, position.y) + CAR_CLEARANCE;
      const heading = Math.atan2(position.z - previous.z, position.x - previous.x);
      this.parked.set(retirement.driverNumber, { time, position, heading, pitch: 0 });
    }
  }

  apply(placements: BaseCarPlacement[], now: number): BaseCarPlacement[] {
    return placements.flatMap((placement) => {
      const number = placement.car.driver.driverNumber;
      if (this.absent.has(number)) return [];
      const visit = this.visits.get(number)?.find(({ start, end }) => now >= start && now <= end);
      let result = this.lane && visit ? this.placeInLane(placement, this.lane, visit, now) : placement;
      const parked = this.parked.get(number);
      if (parked && now >= parked.time - 1200) {
        const weight = THREE.MathUtils.smootherstep(now, parked.time - 1200, parked.time);
        result = blendPose(result, parked, weight);
      }
      return [result];
    });
  }

  private roadDistance(point: THREE.Vector3): number {
    const distanceSq = (segment: ReturnType<typeof pathSegments>[number]) => segmentProjection(point.x, point.z, segment).distanceSq;
    const nearest = this.road.nearest(point.x, point.z, distanceSq);
    return nearest ? Math.sqrt(distanceSq(nearest)) : Infinity;
  }

  private pitProgress(point: THREE.Vector3): number | null {
    if (!this.lane) return null;
    const projection = this.lane.path.projectPointPlanar(point);
    if (!projection) return null;
    const pitDistance = Math.hypot(point.x - projection.point.x, point.z - projection.point.z);
    if (pitDistance > this.lane.width / 2 + 4) return null;
    const roadDistance = this.roadDistance(point);
    return roadDistance > this.trackWidth / 2 - 1 && pitDistance + 2 < roadDistance ? projection.distance : null;
  }

  private findVisits(
    lane: PitLane, samples: CarSample[], stops: PitStop[], bounds: THREE.Box3,
    raceStart: number, end: number, retirementTime?: number,
  ): PitVisit[] {
    const groups: ProgressSample[][] = [];
    for (const sample of samples) {
      const point = vectorFromPoint(sample, this.transform).setY(0);
      if (!bounds.containsPoint(point)) continue;
      const distance = this.pitProgress(point);
      if (distance === null) continue;
      const last = groups.at(-1)?.at(-1);
      if (!last || sample.t - last.t > PIT_MATCH_GAP_MS || distance < last.distance - 25) groups.push([]);
      groups.at(-1)!.push({ t: sample.t, distance });
    }

    const visits: PitVisit[] = [];
    for (const group of groups) {
      const first = group[0];
      const last = group.at(-1)!;
      const recorded = stops.find((stop) => stop.entryTime <= last.t + 2000 && stop.exitTime >= first.t - 2000);
      const startsInLane = first.t <= samples[0].t + 1000;
      const nearRetirement = retirementTime !== undefined && Math.abs(last.t - retirementTime) <= 10000;
      const minimumTravel = first.t < raceStart ? 15 : Math.max(100, lane.path.totalLength * 0.35);
      if (group.length < 3 || (!recorded && !startsInLane && !nearRetirement && last.distance - first.distance < minimumTravel)) continue;
      const start = Math.max(0, first.t - ENTRY_BLEND_MS, visits.at(-1)?.end ?? 0);
      const finish = Math.min(end, last.t + EXIT_HEIGHT_BLEND_MS);
      if (start >= finish) continue;
      const progress: ProgressSample[] = [];
      for (const sample of samples) {
        if (sample.t < start || sample.t > finish) continue;
        const point = vectorFromPoint(sample, this.transform);
        const projection = lane.path.projectPointPlanar(point);
        if (!projection) continue;
        progress.push({ t: sample.t, distance: Math.max(progress.at(-1)?.distance ?? 0, projection.distance) });
      }
      if (progress.length < 2) continue;
      const visit: PitVisit = { start, entry: startsInLane ? start : Math.max(start, first.t), exit: last.t, end: finish, progress };
      const stopStart = recorded?.stopStart;
      const stopEnd = recorded?.stopEnd;
      if (stopStart != null && stopEnd != null && stopStart >= first.t && stopEnd <= last.t && stopEnd > stopStart) {
        const distance = progressAt(progress, (stopStart + stopEnd) / 2);
        visit.stop = { start: stopStart, end: stopEnd, offset: this.parkingOffset(lane, distance) };
        visit.progress = [...progress.filter((point) => point.t < stopStart).map((point) => ({ ...point, distance: Math.min(point.distance, distance) })),
          { t: stopStart, distance }, { t: stopEnd, distance },
          ...progress.filter((point) => point.t > stopEnd).map((point) => ({ ...point, distance: Math.max(point.distance, distance) }))];
      }
      visits.push(visit);
    }
    return visits;
  }

  private parkingOffset(lane: PitLane, distance: number): number {
    const offset = Math.min(2.6, lane.width / 2 - 1.3);
    return this.roadDistance(this.lanePose(lane, distance, offset).position) >=
      this.roadDistance(this.lanePose(lane, distance, -offset).position) ? offset : -offset;
  }

  private lanePose(lane: PitLane, distance: number, offset: number): Omit<ParkedCar, "time"> {
    const position = lane.path.pointAt(distance);
    const front = lane.path.pointAt(distance + 3);
    const rear = lane.path.pointAt(distance - 3);
    const direction = front.clone().sub(rear).normalize();
    const x = position.x - direction.z * offset;
    const z = position.z + direction.x * offset;
    const height = lane.heightAt(x, z, NaN);
    if (Number.isFinite(height)) position.set(x, height, z);
    else position.y = lane.heightAt(position.x, position.z, this.circuitHeight(position.x, position.z, 0));
    const frontY = lane.heightAt(front.x, front.z, position.y);
    const rearY = lane.heightAt(rear.x, rear.z, position.y);
    position.y += CAR_CLEARANCE;
    return { position, heading: Math.atan2(direction.z, direction.x), pitch: Math.atan2(frontY - rearY, front.distanceTo(rear)) };
  }

  private placeInLane(placement: BaseCarPlacement, lane: PitLane, visit: PitVisit, now: number): BaseCarPlacement {
    const entry = visit.entry === visit.start ? 1 : THREE.MathUtils.smootherstep(now, visit.start, visit.entry);
    const heightExit = visit.exit === visit.end ? 1 : 1 - THREE.MathUtils.smootherstep(now, visit.exit, visit.end);
    const heightWeight = 1 - (1 - Math.min(entry, heightExit)) ** 4;
    if (heightWeight <= 0) return placement;
    const exit = 1 - THREE.MathUtils.smootherstep(now, visit.exit, visit.exit + EXIT_BLEND_MS);
    const weight = Math.min(entry, exit);
    const stop = visit.stop;
    const offset = stop ? stop.offset * Math.min(
      THREE.MathUtils.smootherstep(now, stop.start - 2200, stop.start),
      1 - THREE.MathUtils.smootherstep(now, stop.end, stop.end + 2200),
    ) : 0;
    const pose = this.lanePose(lane, progressAt(visit.progress, now), offset);
    const result = blendPose(placement, pose, weight);
    const { x, z } = result.position;
    const height = lane.heightAt(x, z, this.circuitHeight(x, z, pose.position.y - CAR_CLEARANCE));
    result.position.y = THREE.MathUtils.lerp(placement.position.y, height + CAR_CLEARANCE, heightWeight);
    return result;
  }
}
