import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { DriverInfo } from "../../../types";
import { carHeadingToRotationY } from "../../car-models";
import type { BaseCarPlacement } from "../../car-placement";
import type { CameraModeHandler, CameraUpdateContext } from "../types";

const HELMET_HEIGHT_METERS = 1.05;
const COCKPIT_FORWARD_METERS = -0.15;
const LOOK_AHEAD_METERS = 50;

const _carOrientation = new THREE.Euler(0, 0, 0, "YXZ");
const _carQuaternion = new THREE.Quaternion();
const _localEye = new THREE.Vector3();
const _lookDir = new THREE.Vector3();

export class OnboardCameraMode implements CameraModeHandler {
  private followDriverNumber: number | null = null;
  private subjectNumber: number | null = null;

  setDrivers(drivers: DriverInfo[]) {
    if (this.followDriverNumber !== null) {
      return;
    }
    this.followDriverNumber = drivers[0]?.driverNumber ?? null;
  }

  setFollowDriver(driverNumber: number) {
    this.followDriverNumber = driverNumber;
  }

  getFollowDriver(): number | null {
    return this.followDriverNumber;
  }

  getSubjectNumber(): number | null {
    return this.subjectNumber;
  }

  onActivate(controls: OrbitControls) {
    controls.enabled = false;
  }

  onDeactivate() {}

  reset() {}

  update(context: CameraUpdateContext): string {
    context.controls.enabled = false;

    const target = this.resolveTargetPlacement(context.placements);
    this.subjectNumber = target?.car.driver.driverNumber ?? null;
    if (!target) {
      return "";
    }

    const { car, position, heading } = target;
    const yaw = carHeadingToRotationY(heading);

    _carOrientation.set(-car.pitch, yaw, 0);
    _carQuaternion.setFromEuler(_carOrientation);

    _localEye.set(0, HELMET_HEIGHT_METERS, COCKPIT_FORWARD_METERS);
    _localEye.applyQuaternion(_carQuaternion);

    const eye = position.clone().add(_localEye);

    context.camera.position.copy(eye);
    context.camera.rotation.order = "YXZ";
    context.camera.rotation.set(car.pitch, yaw + Math.PI, 0);
    _lookDir.set(0, 0, -1).applyQuaternion(context.camera.quaternion);
    context.controls.target.copy(eye).addScaledVector(_lookDir, LOOK_AHEAD_METERS);

    return `On-board ${car.driver.acronym}`;
  }

  private resolveTargetPlacement(placements: BaseCarPlacement[]): BaseCarPlacement | null {
    if (placements.length === 0) {
      return null;
    }

    if (this.followDriverNumber !== null) {
      const selected = placements.find(
        ({ car }) => car.driver.driverNumber === this.followDriverNumber,
      );
      if (selected) {
        return selected;
      }
    }

    const leader =
      placements.find(({ car }) => car.sample.position === 1) ??
      placements.slice().sort((a, b) => {
        const posA = a.car.sample.position ?? Number.MAX_SAFE_INTEGER;
        const posB = b.car.sample.position ?? Number.MAX_SAFE_INTEGER;
        return posA - posB;
      })[0];

    return leader ?? null;
  }
}
