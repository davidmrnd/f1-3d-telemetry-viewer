import type { BroadcastCameraSelection, BroadcastCarInput, CornerCameraDefinition } from "./types";

const MIN_SCORE_TO_SWITCH = 0.35;
const HYSTERESIS_RATIO = 0.72;
const SWITCH_COOLDOWN_SECONDS = 1.8;
const LEADER_BONUS = 1.6;
const PACK_BONUS = 0.45;
const MAX_VIEW_DISTANCE_METERS = 130;
const MIN_VIEW_DISTANCE_METERS = 8;
const MIN_FACING_DOT = 0.22;

export class BroadcastDirector {
  private activeCameraId: number | null = null;
  private cooldownRemaining = 0;

  reset() {
    this.activeCameraId = null;
    this.cooldownRemaining = 0;
  }

  select(
    cameras: CornerCameraDefinition[],
    cars: BroadcastCarInput[],
    deltaSeconds: number,
  ): BroadcastCameraSelection | null {
    if (cameras.length === 0) {
      return null;
    }

    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - deltaSeconds);

    const scored = cameras
      .map((camera) => ({
        camera,
        score: scoreCamera(camera, cars),
      }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    const active = scored.find((entry) => entry.camera.id === this.activeCameraId);

    if (!best || best.score <= 0) {
      return this.selectIdleCamera(cameras, cars, active?.camera ?? null);
    }

    const shouldKeepActive =
      active &&
      active.score > 0 &&
      (this.cooldownRemaining > 0 || active.score >= best.score * HYSTERESIS_RATIO);

    if (shouldKeepActive && active) {
      return active;
    }

    if (
      best.score >= MIN_SCORE_TO_SWITCH &&
      (!active || active.score <= 0 || best.score > active.score * (1 / HYSTERESIS_RATIO))
    ) {
      if (this.activeCameraId !== best.camera.id) {
        this.cooldownRemaining = SWITCH_COOLDOWN_SECONDS;
      }
      this.activeCameraId = best.camera.id;
      return best;
    }

    if (active && active.score > 0) {
      return active;
    }

    this.activeCameraId = best.camera.id;
    return best;
  }

  private selectIdleCamera(
    cameras: CornerCameraDefinition[],
    cars: BroadcastCarInput[],
    activeCamera: CornerCameraDefinition | null,
  ): BroadcastCameraSelection {
    const leader = pickLeader(cars);
    const leaderCamera = leader ? pickBestCameraForCar(cameras, leader, 0.05) : null;
    const fallbackCamera =
      leaderCamera ??
      (leader ? pickNearestCameraToCar(cameras, leader) : null) ??
      activeCamera ??
      (this.activeCameraId !== null
        ? (cameras.find((camera) => camera.id === this.activeCameraId) ?? null)
        : null);

    const chosen = fallbackCamera ?? cameras[0];
    this.activeCameraId = chosen.id;
    return { camera: chosen, score: 0 };
  }
}

function pickLeader(cars: BroadcastCarInput[]): BroadcastCarInput | null {
  return cars.find((car) => car.racePosition === 1) ?? cars[0] ?? null;
}

function pickBestCameraForCar(
  cameras: CornerCameraDefinition[],
  car: BroadcastCarInput,
  minFacing: number,
): CornerCameraDefinition | null {
  let bestCamera: CornerCameraDefinition | null = null;
  let bestScore = 0;

  for (const camera of cameras) {
    const score = viewScore(camera, car, minFacing);
    if (score > bestScore) {
      bestScore = score;
      bestCamera = camera;
    }
  }

  return bestCamera;
}

function pickNearestCameraToCar(
  cameras: CornerCameraDefinition[],
  car: BroadcastCarInput,
): CornerCameraDefinition {
  let nearest = cameras[0];
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const camera of cameras) {
    const distance = camera.lookAt.distanceToSquared(car.position);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = camera;
    }
  }

  return nearest;
}

function scoreCamera(camera: CornerCameraDefinition, cars: BroadcastCarInput[]): number {
  let score = 0;
  let carsInView = 0;

  for (const car of cars) {
    const view = viewScore(camera, car, MIN_FACING_DOT);
    if (view <= 0) {
      continue;
    }

    score += view;

    if (car.racePosition === 1) {
      score += view * LEADER_BONUS;
    }

    carsInView += 1;
  }

  if (carsInView >= 2) {
    score += PACK_BONUS * Math.min(carsInView - 1, 3);
  }

  return score;
}

function viewScore(
  camera: CornerCameraDefinition,
  car: BroadcastCarInput,
  minFacing: number,
): number {
  const toCar = car.position.clone().sub(camera.position);
  const distance = toCar.length();
  if (distance > MAX_VIEW_DISTANCE_METERS || distance < MIN_VIEW_DISTANCE_METERS) {
    return 0;
  }

  const forward = camera.lookAt.clone().sub(camera.position);
  if (forward.lengthSq() <= 1e-8) {
    return 0;
  }

  forward.normalize();
  toCar.normalize();

  const facing = forward.dot(toCar);
  if (facing < minFacing) {
    return 0;
  }

  const proximity = 1 - distance / MAX_VIEW_DISTANCE_METERS;
  return proximity * facing;
}
