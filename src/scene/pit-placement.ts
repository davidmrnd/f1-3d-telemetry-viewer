import * as THREE from "three";
import type { CarSample, PitStop, ReplaySegment } from "../types";
import { sampleSpeedAt, type BaseCarPlacement } from "./car-placement";
import type { TrackPath } from "./cameras/automatic/track-path";
import { pathSegments, segmentProjection } from "./track/path";
import { SpatialIndex } from "./track/spatial";
import type { PitLane, createCircuitHeightSampler } from "./track/pit-lane";
import { vectorFromPoint, type SceneTransform } from "./track-geometry";

const CAR_CLEARANCE = 0.02;
const PIT_MATCH_GAP_MS = 2500;
const TRACK_BLEND_MS = 1200;
const JOIN_LOOKBACK_MS = 3500;
const JOIN_LOOKAHEAD_MS = 3000;

type HeightSampler = ReturnType<typeof createCircuitHeightSampler>;

interface ProgressSample {
  t: number;
  distance: number;
}

interface PitVisit {
  start: number;
  end: number;
  progress: ProgressSample[];
  blendIn: boolean;
  blendOut: boolean;
  stop?: { start: number; end: number; offset: number };
}

interface RoadJoin {
  arc: number;
  offset: THREE.Vector3;
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

function simulateProgress(samples: CarSample[], anchors: ProgressSample[]): ProgressSample[] {
  const progress = [anchors[0]];
  for (let i = 1; i < anchors.length; i++) {
    const from = anchors[i - 1];
    const to = anchors[i];
    const times = samples.filter((sample) => sample.t > from.t && sample.t < to.t).map((sample) => sample.t);
    times.push(to.t);
    let distance = 0;
    let previousTime = from.t;
    let previousSpeed = Math.max(0, sampleSpeedAt(samples, from.t) ?? 0);
    const travel = times.map((t) => {
      const speed = Math.max(0, sampleSpeedAt(samples, t) ?? 0);
      distance += (speed + previousSpeed) * (t - previousTime) / 7200;
      previousTime = t;
      previousSpeed = speed;
      return { t, distance };
    });
    for (const point of travel) {
      const ratio = distance > 0.01 ? point.distance / distance : (point.t - from.t) / (to.t - from.t);
      progress.push({ t: point.t, distance: THREE.MathUtils.lerp(from.distance, to.distance, ratio) });
    }
  }
  return progress;
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
  private readonly joins: [RoadJoin, RoadJoin] | null;

  constructor(
    segment: ReplaySegment,
    private readonly lane: PitLane | null,
    private readonly main: TrackPath,
    private readonly trackWidth: number,
    private readonly transform: SceneTransform,
    private readonly circuitHeight: HeightSampler,
  ) {
    this.road = new SpatialIndex(pathSegments([...main.points], false));
    this.joins = lane ? [this.roadJoin(lane.path.points[0]), this.roadJoin(lane.path.points.at(-1)!)] : null;
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

  private roadJoin(point: THREE.Vector3): RoadJoin {
    const projection = this.main.projectPointPlanar(point)!;
    return { arc: projection.distance, offset: point.clone().sub(projection.point).setY(0) };
  }

  private findRoadAnchor(samples: CarSample[], time: number, join: RoadJoin, side: -1 | 1): ProgressSample | null {
    const next = samples.findIndex((sample) => sample.t >= time);
    let i = side < 0 && samples[next]?.t !== time ? (next < 0 ? samples.length : next) - 1 : next;
    for (; samples[i] && Math.abs(samples[i].t - time) <= 3500; i += side) {
      const sample = samples[i];
      const position = vectorFromPoint(sample, this.transform);
      const projection = this.main.projectPointPlanar(position)!;
      const distance = this.main.signedDistance(join.arc, projection.distance);
      const lateral = Math.hypot(position.x - projection.point.x, position.z - projection.point.z);
      if (side * distance >= 10 && side * distance <= 450 && lateral <= this.trackWidth / 2 + 0.5) {
        return { t: sample.t, distance };
      }
    }
    return null;
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
      const [entryJoin, exitJoin] = this.joins!;
      const approach = startsInLane ? null : this.findRoadAnchor(samples, first.t - JOIN_LOOKBACK_MS, entryJoin, -1);
      const rejoin = this.findRoadAnchor(samples, last.t + JOIN_LOOKAHEAD_MS, exitJoin, 1);
      const previousEnd = visits.at(-1)?.end ?? 0;
      const start = Math.max(0, previousEnd, approach?.t ?? first.t - TRACK_BLEND_MS);
      const finish = Math.min(end, rejoin?.t ?? last.t + TRACK_BLEND_MS);
      if (start >= finish) continue;
      const anchors: ProgressSample[] = [{ t: start, distance: approach?.distance ?? first.distance }];
      const finishDistance = rejoin ? lane.path.totalLength + rejoin.distance : Math.max(first.distance, last.distance);
      const visit: PitVisit = {
        start, end: finish, progress: [],
        blendIn: !startsInLane, blendOut: finish < end && !nearRetirement,
      };
      const stopStart = recorded?.stopStart;
      const stopEnd = recorded?.stopEnd;
      if (stopStart != null && stopEnd != null && stopStart > start && stopEnd < finish && stopEnd > stopStart) {
        const distance = THREE.MathUtils.clamp(progressAt(group, (stopStart + stopEnd) / 2), anchors[0].distance, finishDistance);
        visit.stop = { start: stopStart, end: stopEnd, offset: this.parkingOffset(lane, distance) };
        anchors.push({ t: stopStart, distance }, { t: stopEnd, distance });
      }
      anchors.push({ t: finish, distance: finishDistance });
      visit.progress = simulateProgress(samples, anchors);
      visits.push(visit);
    }
    return visits;
  }

  private parkingOffset(lane: PitLane, distance: number): number {
    const offset = Math.min(2.6, lane.width / 2 - 1.3);
    return this.roadDistance(this.lanePose(lane, distance, offset).position) >=
      this.roadDistance(this.lanePose(lane, distance, -offset).position) ? offset : -offset;
  }

  private lanePoint(lane: PitLane, distance: number, offset: number): THREE.Vector3 {
    const position = lane.path.pointAt(distance);
    if (offset !== 0) {
      const direction = lane.path.pointAt(distance + 3).sub(lane.path.pointAt(distance - 3)).normalize();
      const x = position.x - direction.z * offset;
      const z = position.z + direction.x * offset;
      if (Number.isFinite(lane.heightAt(x, z, NaN))) position.set(x, 0, z);
    }
    position.y = lane.heightAt(position.x, position.z, this.circuitHeight(position.x, position.z, 0));
    position.y += CAR_CLEARANCE;
    return position;
  }

  private lanePose(lane: PitLane, distance: number, offset: number): Omit<ParkedCar, "time"> {
    const direction = this.lanePoint(lane, distance + 3, offset).sub(this.lanePoint(lane, distance - 3, offset));
    return {
      position: this.lanePoint(lane, distance, offset),
      heading: Math.atan2(direction.z, direction.x),
      pitch: Math.atan2(direction.y, Math.hypot(direction.x, direction.z)),
    };
  }

  private routePoint(lane: PitLane, distance: number, offset: number): THREE.Vector3 {
    const length = lane.path.totalLength;
    if (distance >= 0 && distance <= length) return this.lanePoint(lane, distance, offset);
    const [entry, exit] = this.joins!;
    const join = distance < 0 ? entry : exit;
    const along = distance < 0 ? distance : distance - length;
    const position = this.main.pointAt(join.arc + along);
    position.addScaledVector(join.offset, 1 - THREE.MathUtils.smoothstep(Math.abs(along), 0, 45));
    const height = this.circuitHeight(position.x, position.z, position.y);
    position.y = lane.heightAt(position.x, position.z, height) + CAR_CLEARANCE;
    return position;
  }

  private placeInLane(placement: BaseCarPlacement, lane: PitLane, visit: PitVisit, now: number): BaseCarPlacement {
    const entry = visit.blendIn ? THREE.MathUtils.smootherstep(now, visit.start, visit.start + TRACK_BLEND_MS) : 1;
    const exit = visit.blendOut ? 1 - THREE.MathUtils.smootherstep(now, visit.end - TRACK_BLEND_MS, visit.end) : 1;
    const weight = Math.min(entry, exit);
    if (weight <= 0) return placement;
    const stop = visit.stop;
    const offset = stop ? stop.offset * Math.min(
      THREE.MathUtils.smootherstep(now, stop.start - 2200, stop.start),
      1 - THREE.MathUtils.smootherstep(now, stop.end, stop.end + 2200),
    ) : 0;
    const distance = progressAt(visit.progress, now);
    const position = this.routePoint(lane, distance, offset);
    const direction = this.routePoint(lane, distance + 5, offset).sub(this.routePoint(lane, distance - 5, offset));
    const heading = Math.atan2(direction.z, direction.x);
    const pitch = Math.atan2(direction.y, Math.hypot(direction.x, direction.z));
    return blendPose(placement, { position, heading, pitch }, weight);
  }
}
