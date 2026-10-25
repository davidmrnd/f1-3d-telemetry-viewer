import * as THREE from "three";
import { rankBroadcastAction, type BroadcastAction } from "./broadcast-action";
import type { TrackPath } from "./track-path";
import type {
  BroadcastCameraSelection,
  BroadcastCarInput,
  BroadcastShot,
  BroadcastShotKind,
  CornerCameraDefinition,
} from "./types";

const MIN_SHOT_SECONDS = 6;

export class BroadcastDirector {
  private activeShot: BroadcastShot | null = null;
  private shotSeconds = 0;
  private elapsed = 0;
  private shotCount = 0;
  private readonly exposure = new Map<number, number>();
  private readonly lastStyle = new Map<BroadcastShotKind, number>();
  private readonly lastStation = new Map<number, number>();

  reset() {
    this.activeShot = null;
    this.shotSeconds = 0;
    this.elapsed = 0;
    this.shotCount = 0;
    this.exposure.clear();
    this.lastStyle.clear();
    this.lastStation.clear();
  }

  select(
    cameras: CornerCameraDefinition[],
    cars: BroadcastCarInput[],
    path: TrackPath,
    deltaSeconds: number,
    eventDrivers: readonly number[] = [],
  ): BroadcastCameraSelection | null {
    if (cameras.length === 0 || cars.length === 0) return null;
    const active = this.activeShot;
    let subject = cars.find((car) => car.driverNumber === active?.subjectNumber);
    if (active?.kind === "aerial" && subject && subject.position.distanceTo(active.lookAt) > active.radius * 0.85) {
      subject = cars.reduce((nearest, car) => car.position.distanceToSquared(active.lookAt) <
        nearest.position.distanceToSquared(active.lookAt) ? car : nearest);
      active.subjectNumber = subject.driverNumber;
      if (!active.groupDriverNumbers.includes(subject.driverNumber)) active.groupDriverNumbers.push(subject.driverNumber);
    }
    if (deltaSeconds === 0 && active && subject) return { ...active, subject };

    this.elapsed += deltaSeconds;
    this.shotSeconds += deltaSeconds;
    for (const [driver, shown] of this.exposure) {
      this.exposure.set(driver, shown * Math.exp(-deltaSeconds / 50));
    }
    if (active && subject) {
      for (const driver of active.groupDriverNumbers) {
        const weight = driver === subject.driverNumber ? 1 : active.kind === "aerial" ? 0.25 : 0.5;
        this.exposure.set(driver, (this.exposure.get(driver) ?? 0) + deltaSeconds * weight);
      }
      const urgentAction = this.shotSeconds >= MIN_SHOT_SECONDS && eventDrivers.length > 0 &&
        !eventDrivers.some((driver) => active.groupDriverNumbers.includes(driver));
      if (!urgentAction && !this.shouldEndShot(active, subject, path)) return { ...active, subject };
    }

    const ranked = rankBroadcastAction(cars, eventDrivers, this.exposure, active?.subjectNumber ?? null);
    let action = ranked[0];
    const attacker = ranked.find((entry) => entry.attacking && entry.battle > 2 && entry.score >= action.score - 2);
    let kind = this.chooseStyle(action, active?.kind ?? null, attacker !== undefined);
    if (kind === "onboard") {
      if (attacker) action = attacker;
      else kind = "aerial";
    }
    const projection = path.projectPointPlanar(action.car.position);
    if (!projection) return null;
    const forward = new THREE.Vector3(Math.cos(action.car.heading), 0, Math.sin(action.car.heading));
    const direction = path.tangentAt(projection).dot(forward) < 0 ? -1 : 1;
    const speed = action.car.velocity.length();
    const base = {
      id: ++this.shotCount,
      subjectNumber: action.car.driverNumber,
      groupDriverNumbers: action.group.map((car) => car.driverNumber),
      duration: 9 + this.shotCount % 3,
    };
    let shot: BroadcastShot;
    if (kind === "onboard") {
      shot = { ...base, kind, duration: 11 + this.shotCount % 4 };
    } else if (kind === "aerial") {
      const points = action.group.map((car) => car.position.clone());
      const travel = THREE.MathUtils.clamp(speed * 3.2, 180, 360);
      for (let distance = -40; distance <= travel + 40; distance += 20) {
        points.push(path.pointAt(projection.distance + direction * distance));
      }
      const bounds = new THREE.Box3().setFromPoints(points);
      const center = bounds.getCenter(new THREE.Vector3());
      const radius = Math.max(75, ...points.map((point) => point.distanceTo(center))) + 20;
      const tangent = path.tangentAt(projection).multiplyScalar(direction);
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
      const position = center.clone().addScaledVector(side, radius * 1.15).addScaledVector(tangent, -radius * 0.65);
      position.y += radius * 1.6;
      shot = { ...base, kind, position, lookAt: center, radius };
    } else {
      const camera = this.chooseTrackside(cameras, action.car, path, projection.distance, direction, speed);
      shot = { ...base, kind, camera, duration: 12 + this.shotCount % 3 };
      this.lastStation.set(camera.id, this.elapsed);
    }
    this.activeShot = shot;
    this.shotSeconds = 0;
    this.lastStyle.set(kind, this.elapsed);
    return { ...shot, subject: action.car };
  }

  private shouldEndShot(shot: BroadcastShot, subject: BroadcastCarInput, path: TrackPath): boolean {
    if (this.shotSeconds >= shot.duration) return true;
    if (shot.kind === "aerial") {
      return this.shotSeconds >= MIN_SHOT_SECONDS && subject.position.distanceTo(shot.lookAt) > shot.radius;
    }
    if (shot.kind !== "trackside") return false;
    const projection = path.projectPointPlanar(subject.position);
    if (!projection) return true;
    const forward = new THREE.Vector3(Math.cos(subject.heading), 0, Math.sin(subject.heading));
    const direction = path.tangentAt(projection).dot(forward) < 0 ? -1 : 1;
    const ahead = path.signedDistance(projection.distance, shot.camera.trackDistance) * direction;
    const exitDistance = Math.max(130, subject.velocity.length() * 2.8);
    const outOfRange = subject.position.distanceTo(shot.camera.position) > shot.camera.coverageRadius;
    return this.shotSeconds >= MIN_SHOT_SECONDS && (ahead < -exitDistance || outOfRange);
  }

  private chooseStyle(action: BroadcastAction, previous: BroadcastShotKind | null, canUseOnboard: boolean): BroadcastShotKind {
    if (!previous) return action.car.velocity.length() < 3 ? "aerial" : "trackside";
    const since = (kind: BroadcastShotKind, initial: number) => this.elapsed - (this.lastStyle.get(kind) ?? -initial);
    const styles: { kind: BroadcastShotKind; score: number }[] = [
      { kind: "trackside", score: 1.9 + (action.battle > 4 ? 0.3 : 0) - (previous === "trackside" ? 1.2 : 0) },
      { kind: "aerial", score: since("aerial", 26) >= 26 && previous !== "aerial"
        ? 0.4 + since("aerial", 26) / 32 + (action.group.length > 3 ? 0.35 : 0) : -Infinity },
      { kind: "onboard", score: canUseOnboard && previous !== "onboard"
        ? 0.5 + since("onboard", 15) / 25 : -Infinity },
    ];
    return styles.sort((a, b) => b.score - a.score)[0].kind;
  }

  private chooseTrackside(
    cameras: CornerCameraDefinition[],
    subject: BroadcastCarInput,
    path: TrackPath,
    distanceAlongTrack: number,
    direction: number,
    speed: number,
  ): CornerCameraDefinition {
    const ideal = 75 + speed * 2.6;
    const ranked = cameras.map((camera) => {
      const ahead = path.signedDistance(distanceAlongTrack, camera.trackDistance) * direction;
      const distance = camera.position.distanceTo(subject.position);
      const recentlyUsed = this.elapsed - (this.lastStation.get(camera.id) ?? -100);
      const score = ahead >= -30 && ahead <= camera.coverageRadius && distance >= 22 && distance < camera.coverageRadius
        ? Math.exp(-(((ahead - ideal) / 190) ** 2)) * (camera.corner ? 1.3 : 1) - Math.max(0, 35 - recentlyUsed) * 0.025
        : -Infinity;
      return { camera, score, distance };
    }).sort((a, b) => b.score - a.score);
    return Number.isFinite(ranked[0].score)
      ? ranked[0].camera
      : ranked.reduce((nearest, entry) => entry.distance < nearest.distance ? entry : nearest).camera;
  }
}
