import { Vector3 } from "three";
import type { DrivingSurface, FrameCarState, LapGate, ReplaySegment, VehiclePose } from "../types";
import type { BaseCarPlacement } from "./car-placement";
import type { TrackPath } from "./cameras/automatic/track-path";
import type { StartFinishDecor } from "./start-finish";
import { vectorFromPoint, type SceneTransform } from "./track-geometry";
import type { createTerrainHeightSampler } from "./track/terrain-height";
import { DrivingRaceOrder } from "./traffic/driving-race-order";

type HeightSampler = ReturnType<typeof createTerrainHeightSampler>;

export class DrivingTrack {
  constructor(
    private readonly path: TrackPath,
    private readonly width: number,
    private readonly transform: SceneTransform,
    private readonly finish: StartFinishDecor["pose"] | undefined,
    private readonly roadHeight: HeightSampler,
    private readonly groundHeight: HeightSampler,
    private readonly pitHeight: HeightSampler | undefined,
  ) {}

  readonly surface = (x: number, z: number, fallbackY: number): DrivingSurface => {
    const road = this.roadHeight(x, z, NaN);
    if (Number.isFinite(road)) return { height: road, asphalt: true, mainTrack: true };
    const pit = this.pitHeight?.(x, z, NaN);
    if (pit !== undefined && Number.isFinite(pit)) return { height: pit, asphalt: true, mainTrack: false };
    return { height: this.groundHeight(x, z, fallbackY), asphalt: false, mainTrack: false };
  };

  recordedPose(car: FrameCarState): VehiclePose {
    const { x, y, z } = vectorFromPoint(car.sample, this.transform);
    const surface = this.surface(x, z, y);
    return { x, y: (surface.asphalt && Math.abs(surface.height - y) < 4 ? surface.height : y) + 0.035,
      z, heading: car.heading, pitch: car.pitch };
  }

  createRaceOrder(segment: ReplaySegment, start: number, placements: BaseCarPlacement[], driverNumber: number) {
    if (this.path.totalLength <= 0) return null;
    return new DrivingRaceOrder(this.path, this.finish ?? { distance: 0, direction: 1 }, segment, start, placements, driverNumber);
  }

  lapGates(reference: VehiclePose): LapGate[] {
    if (!this.path.closed || this.path.totalLength < 100) {
      throw new Error("El circuito necesita un trazado cerrado para cronometrar una vuelta.");
    }
    const projection = this.path.projectPointPlanar(new Vector3(reference.x, reference.y, reference.z))!;
    const tangent = this.path.tangentAt(projection);
    const direction = Math.cos(reference.heading) * tangent.x + Math.sin(reference.heading) * tangent.z < 0 ? -1 : 1;
    const start = this.finish?.distance ?? projection.distance;
    const count = Math.max(8, Math.ceil(this.path.totalLength / 310));
    return Array.from({ length: count }, (_, index) => {
      const distance = start + direction * this.path.totalLength * (index + 1) / count;
      const origin = this.path.pointAt(distance);
      const heading = this.path.pointAt(distance + direction).sub(this.path.pointAt(distance - direction));
      return { origin, heading: Math.atan2(heading.z, heading.x), halfWidth: this.width / 2 };
    });
  }
}
