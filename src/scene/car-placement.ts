import * as THREE from "three";
import type { FrameCarState, ReplayFrame, StartingGridSlot, TrackPhase } from "../types";
import { type SceneTransform, vectorFromPoint } from "./track-geometry";

/** Holgura sobre el asfalto para evitar z-fighting (m). */
const CAR_TRACK_CLEARANCE_METERS = 0.02;

const GRID_LATERAL_OFFSET_METERS = 2.8;
const GRID_PACK_SPEED_KMH = 5;

export interface BaseCarPlacement {
  car: FrameCarState;
  position: THREE.Vector3;
}

export type VisualPlacementOptions = {
  startingGrid?: StartingGridSlot[];
};

export function buildBasePlacements(frame: ReplayFrame, transform: SceneTransform): BaseCarPlacement[] {
  return frame.cars.map((car) => {
    const position = vectorFromPoint(
      {
        x: car.sample.x,
        y: car.sample.y,
        z: car.sample.z,
      },
      transform,
    );
    position.y += CAR_TRACK_CLEARANCE_METERS;
    return { car, position };
  });
}

export function buildLaneOffsets(placements: BaseCarPlacement[]) {
  return new Map(placements.map(({ car }) => [car.driver.driverNumber, car.lateralOffset]));
}

function packIsStationary(frame: ReplayFrame) {
  return frame.cars.length > 0 && frame.cars.every((car) => car.sample.speed <= GRID_PACK_SPEED_KMH);
}

export function shouldUseGridPlacement(frame: ReplayFrame) {
  const phase: TrackPhase | undefined = frame.trackStatus?.phase;
  if (phase === "standing_start") {
    return true;
  }
  if (phase === "formation" || phase === "pre_session") {
    return packIsStationary(frame);
  }
  return false;
}

export function buildGridLateralOffsets(startingGrid: StartingGridSlot[]) {
  const offsets = new Map<number, number>();
  for (const slot of startingGrid) {
    const side = slot.position % 2 === 1 ? 1 : -1;
    offsets.set(slot.driverNumber, side * GRID_LATERAL_OFFSET_METERS);
  }
  return offsets;
}

export function buildVisualPlacements(
  frame: ReplayFrame,
  transform: SceneTransform,
  options: VisualPlacementOptions = {},
): BaseCarPlacement[] {
  const basePlacements = buildBasePlacements(frame, transform);
  const startingGrid = options.startingGrid ?? [];
  const useGrid = shouldUseGridPlacement(frame) && startingGrid.length > 0;
  const lateralOffsets = useGrid
    ? buildGridLateralOffsets(startingGrid)
    : buildLaneOffsets(basePlacements);

  return basePlacements.map(({ car, position }) => {
    const laneNormal = new THREE.Vector3(-Math.sin(car.heading), 0, Math.cos(car.heading));
    const offset = lateralOffsets.get(car.driver.driverNumber) ?? 0;
    return {
      car,
      position: position.clone().add(laneNormal.multiplyScalar(offset)),
    };
  });
}
