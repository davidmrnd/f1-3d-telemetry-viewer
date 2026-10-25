import * as THREE from "three";
import type { CameraUpdateContext } from "../types";
import type { BroadcastCameraSelection, BroadcastCarInput } from "./types";

export function setBroadcastFov(context: CameraUpdateContext, fov: number) {
  if (!context.xrPresenting && Math.abs(context.camera.fov - fov) > 0.01) {
    context.camera.fov = fov;
    context.camera.updateProjectionMatrix();
  }
}

export class BroadcastFraming {
  private readonly lookAt = new THREE.Vector3();

  updateTrackside(
    context: CameraUpdateContext,
    shot: Extract<BroadcastCameraSelection, { kind: "trackside" }>,
    cars: BroadcastCarInput[],
    cut: boolean,
  ): BroadcastCarInput[] {
    const { subject, camera: station } = shot;
    const subjectDirection = subject.position.clone().sub(station.position).normalize();
    const group = [subject, ...cars.filter((car) => car !== subject &&
      shot.groupDriverNumbers.includes(car.driverNumber) &&
      car.position.clone().sub(station.position).normalize().dot(subjectDirection) > 0.92 &&
      car.position.distanceToSquared(subject.position) < 65 ** 2,
    ).sort((a, b) => a.position.distanceToSquared(subject.position) - b.position.distanceToSquared(subject.position)).slice(0, 4)];
    const center = new THREE.Vector3();
    const velocity = new THREE.Vector3();
    for (const car of group) {
      center.add(car.position);
      velocity.add(car.velocity);
    }
    center.divideScalar(group.length);
    center.y += 0.8;
    velocity.multiplyScalar(0.09 / group.length).clampLength(0, 6);
    if (cut) this.lookAt.copy(center);
    else this.lookAt.lerp(center.clone().add(velocity), 1 - Math.exp(-18 * context.deltaSeconds));

    const camera = context.camera;
    camera.position.copy(station.position);
    camera.lookAt(this.lookAt);
    camera.updateMatrixWorld();
    context.controls.target.copy(this.lookAt);
    const distance = camera.position.distanceTo(center);
    const radius = Math.max(9, ...group.map((car) => car.position.distanceTo(center) + 5)) * 1.25;
    const aspect = Math.min(1, Math.max(0.2, camera.aspect));
    const desiredFov = THREE.MathUtils.clamp(
      THREE.MathUtils.radToDeg(2 * Math.atan2(radius / aspect, Math.max(1, distance))), 9, 65,
    );
    let safeFov = 0;
    for (const car of group) {
      const local = car.position.clone().add(new THREE.Vector3(0, 0.8, 0)).applyMatrix4(camera.matrixWorldInverse);
      const depth = Math.max(1, -local.z - 3.5);
      const tangent = Math.max((Math.abs(local.x) + 3.5) / camera.aspect, Math.abs(local.y) + 3.5) / depth;
      safeFov = Math.max(safeFov, THREE.MathUtils.radToDeg(2 * Math.atan(tangent * 1.15)));
    }
    const zoom = cut ? desiredFov : THREE.MathUtils.lerp(camera.fov, desiredFov, 1 - Math.exp(-2 * context.deltaSeconds));
    setBroadcastFov(context, Math.max(zoom, safeFov));
    return group;
  }

  updateAerial(context: CameraUpdateContext, shot: Extract<BroadcastCameraSelection, { kind: "aerial" }>) {
    context.camera.position.copy(shot.position);
    context.camera.lookAt(shot.lookAt);
    context.camera.updateMatrixWorld();
    context.controls.target.copy(shot.lookAt);
    const halfAngle = Math.asin(Math.min(0.9, shot.radius / shot.position.distanceTo(shot.lookAt)));
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(halfAngle) / Math.min(1, context.camera.aspect)));
    setBroadcastFov(context, Math.max(48, fov * 1.12));
  }
}
