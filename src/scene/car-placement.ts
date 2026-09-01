import * as THREE from "three";
import type { FrameCarState, ReplayFrame } from "../types";
import { type SceneTransform, vectorFromPoint } from "./track-geometry";

/** Holgura sobre el asfalto para evitar z-fighting (m). */
const CAR_TRACK_CLEARANCE_METERS = 0.02;

/** Distancia en la que empieza el crowding lateral (m). OpenF1 no tiene precisión milimétrica. */
const CROWDING_MIN_PAIR_DISTANCE_METERS = 2.5;
const CROWDING_NEAR_DISTANCE_METERS = 0.6;
const CROWDING_FAR_DISTANCE_METERS = 2.5;
const CROWDING_MAX_OFFSET_METERS = 0.45;
const CROWDING_MIN_OFFSET_METERS = 0.15;

export interface BaseCarPlacement {
  car: FrameCarState;
  position: THREE.Vector3;
}

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

export function buildCrowdingOffsets(placements: BaseCarPlacement[]) {
  const offsets = new Map<number, number>();
  const sorted = placements
    .slice()
    .sort(
      (a, b) =>
        (a.car.sample.position ?? Number.MAX_SAFE_INTEGER) - (b.car.sample.position ?? Number.MAX_SAFE_INTEGER),
    );

  sorted.forEach(({ car }) => offsets.set(car.driver.driverNumber, 0));

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index];
    const next = sorted[index + 1];
    const distance = current.position.distanceTo(next.position);

    if (distance >= CROWDING_MIN_PAIR_DISTANCE_METERS) {
      continue;
    }

    const strength = THREE.MathUtils.clamp(
      THREE.MathUtils.mapLinear(
        distance,
        CROWDING_NEAR_DISTANCE_METERS,
        CROWDING_FAR_DISTANCE_METERS,
        CROWDING_MAX_OFFSET_METERS,
        CROWDING_MIN_OFFSET_METERS,
      ),
      CROWDING_MIN_OFFSET_METERS,
      CROWDING_MAX_OFFSET_METERS,
    );

    offsets.set(
      current.car.driver.driverNumber,
      (offsets.get(current.car.driver.driverNumber) ?? 0) + strength,
    );
    offsets.set(
      next.car.driver.driverNumber,
      (offsets.get(next.car.driver.driverNumber) ?? 0) - strength,
    );
  }

  return offsets;
}

export function buildVisualPlacements(
  frame: ReplayFrame,
  transform: SceneTransform,
): BaseCarPlacement[] {
  const basePlacements = buildBasePlacements(frame, transform);
  const crowdingOffsets = buildCrowdingOffsets(basePlacements);

  return basePlacements.map(({ car, position }) => {
    const laneNormal = new THREE.Vector3(-Math.sin(car.heading), 0, Math.cos(car.heading));
    const offset = crowdingOffsets.get(car.driver.driverNumber) ?? 0;
    return {
      car,
      position: position.clone().add(laneNormal.multiplyScalar(offset)),
    };
  });
}
