import { MathUtils } from "three";
import type { ReplaySegment, TrackPoint3D } from "../../types";
import type { BaseCarPlacement } from "../car-placement";
import type { TrackPath, TrackProjection } from "../cameras/automatic/track-path";

const NEARBY_TRACK_METERS = 50;
const MAX_PROJECTION_WINDOW_METERS = 110;
const POSITION_TIE_METERS = 0.25;

interface CarProgress {
  arc: number;
  distance: number;
  point: TrackPoint3D;
  startingPosition: number;
}

function recordedLapStarts(segment: ReplaySegment) {
  const byDriver = new Map<number, { lap: number; time: number }[]>();
  for (const stint of segment.tyreStints ?? []) {
    const starts = byDriver.get(stint.driverNumber) ?? [];
    stint.lapTimes.forEach((time, index) => {
      if (Number.isFinite(time)) starts.push({ lap: stint.startLap + index, time });
    });
    byDriver.set(stint.driverNumber, starts);
  }
  for (const starts of byDriver.values()) starts.sort((a, b) => a.time - b.time);
  return byDriver;
}

function nearTrack(point: TrackPoint3D, projection: TrackProjection | null): projection is TrackProjection {
  return projection !== null && Math.abs(projection.point.y - point.y) <= 12 &&
    Math.hypot(projection.point.x - point.x, projection.point.z - point.z) <= NEARBY_TRACK_METERS;
}

export class DrivingRaceOrder {
  private readonly initial = new Map<number, CarProgress>();
  private readonly retirements = new Map<number, number>();
  private readonly lapStarts: ReturnType<typeof recordedLapStarts>;
  private progress = new Map<number, CarProgress>();
  private lastTime = -Infinity;

  constructor(
    private readonly path: TrackPath,
    private readonly line: { distance: number; direction: number },
    segment: ReplaySegment,
    private readonly startTime: number,
    placements: readonly BaseCarPlacement[],
    private readonly playerNumber: number,
  ) {
    this.lapStarts = recordedLapStarts(segment);
    const gridStart = segment.trackStatus.some(interval => interval.phase === "standing_start" && interval.start <= startTime);
    const gridPositions = new Map(segment.startingGrid.map(slot => [slot.driverNumber, slot.position]));
    for (const retirement of segment.retirements ?? []) {
      this.retirements.set(retirement.driverNumber, retirement.t);
    }
    for (const [index, { car, position }] of placements.entries()) {
      if (car.retirement) continue;
      const projection = path.projectPointPlanar(position);
      if (!projection) continue;
      const number = car.driver.driverNumber;
      const aroundLine = (projection.distance - line.distance) * line.direction;
      const estimate = this.recordedProgress(number, startTime);
      let distance = aroundLine;
      if (path.closed) {
        distance = gridStart && (estimate ?? 0) < 1
          ? path.signedDistance(line.distance, projection.distance) * line.direction
          : this.alignLap(aroundLine, estimate ?? MathUtils.euclideanModulo(aroundLine, path.totalLength) / path.totalLength);
      }
      this.initial.set(number, { arc: projection.distance, distance, point: position,
        startingPosition: car.sample.position ?? gridPositions.get(number) ?? index + 1 });
    }
    this.reset();
  }

  reset() {
    this.progress = new Map(this.initial);
    this.lastTime = this.startTime;
  }

  update(time: number, player: TrackPoint3D, opponents: readonly BaseCarPlacement[]) {
    if (time !== this.lastTime) {
      this.lastTime = time;
      this.advance(this.playerNumber, player, time);
      for (const { car, position } of opponents) {
        if (!car.retirement) this.advance(car.driver.driverNumber, position, time);
      }
    }
    const playerProgress = this.progress.get(this.playerNumber);
    if (!playerProgress) return null;
    let rank = 1;
    for (const [number, progress] of this.progress) {
      if (number === this.playerNumber || (this.retirements.get(number) ?? Infinity) <= time) continue;
      const lead = progress.distance - playerProgress.distance;
      if (lead > POSITION_TIE_METERS || (Math.abs(lead) <= POSITION_TIE_METERS &&
        progress.startingPosition < playerProgress.startingPosition)) rank++;
    }
    return { rank, total: this.initial.size };
  }

  private recordedProgress(number: number, time: number) {
    const starts = this.lapStarts.get(number);
    if (!starts?.length) return null;
    const next = starts.findIndex(entry => entry.time > time);
    if (next === 0) return null;
    if (next < 0) {
      const last = starts.at(-1)!;
      const previous = starts.at(-2);
      const lapDuration = previous && last.lap > previous.lap ? (last.time - previous.time) / (last.lap - previous.lap) : 0;
      const elapsed = time - last.time;
      return lapDuration > 0 && elapsed <= lapDuration ? last.lap - 1 + elapsed / lapDuration : null;
    }
    const [before, after] = [starts[next - 1], starts[next]];
    const portion = (time - before.time) / (after.time - before.time);
    return before.lap - 1 + portion * (after.lap - before.lap);
  }

  private alignLap(distance: number, estimatedLaps: number) {
    const length = this.path.totalLength;
    return distance + length * Math.round(estimatedLaps - distance / length);
  }

  private advance(number: number, point: TrackPoint3D, time: number) {
    const previous = this.progress.get(number);
    if (!previous) return;
    const moved = Math.hypot(point.x - previous.point.x, point.z - previous.point.z);
    if (moved < 0.01) return;
    const limit = Math.min(MAX_PROJECTION_WINDOW_METERS, 5 + 1.9 * moved);
    let projection = this.path.projectPointPlanar(point, { distance: previous.arc, radius: limit + 10 });
    if (!nearTrack(point, projection) || this.path.linearDistance(previous.arc, projection.distance) > limit) {
      if (number === this.playerNumber) return;
      projection = this.path.projectPointPlanar(point);
      if (!nearTrack(point, projection)) return;
    }
    const step = this.path.signedDistance(previous.arc, projection.distance);
    const estimate = number === this.playerNumber || !this.path.closed ? null : this.recordedProgress(number, time);
    const distance = estimate === null ? previous.distance + this.line.direction * step
      : this.alignLap((projection.distance - this.line.distance) * this.line.direction, estimate);
    this.progress.set(number, { arc: projection.distance, distance,
      point, startingPosition: previous.startingPosition });
  }
}
