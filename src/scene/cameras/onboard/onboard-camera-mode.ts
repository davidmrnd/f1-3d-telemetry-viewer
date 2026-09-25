import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { DriverInfo } from "../../../types";
import type { BaseCarPlacement } from "../../car-placement";
import type { CameraModeHandler, CameraUpdateContext } from "../types";

const HELMET_HEIGHT_METERS = 1.05;
const COCKPIT_FORWARD_OFFSET_METERS = 0.35;
const LOOK_AHEAD_METERS = 55;
const SMOOTHING_RATE = 12;

export class OnboardCameraMode implements CameraModeHandler {
  private followDriverNumber: number | null = null;
  private readonly smoothedPosition = new THREE.Vector3();
  private readonly smoothedLookAt = new THREE.Vector3();
  private initialized = false;

  setDrivers(drivers: DriverInfo[]) {
    if (this.followDriverNumber !== null) {
      return;
    }
    this.followDriverNumber = drivers[0]?.driverNumber ?? null;
  }

  setFollowDriver(driverNumber: number) {
    this.followDriverNumber = driverNumber;
    this.initialized = false;
  }

  getFollowDriver(): number | null {
    return this.followDriverNumber;
  }

  onActivate(controls: OrbitControls) {
    controls.enabled = false;
    this.initialized = false;
  }

  onDeactivate() {}

  reset() {
    this.initialized = false;
  }

  update(context: CameraUpdateContext): string {
    context.controls.enabled = false;

    const target = this.resolveTargetPlacement(context.placements);
    if (!target) {
      return "";
    }

    const { car, position } = target;
    const forward = forwardFromHeading(car.heading, car.pitch);
    const eye = position
      .clone()
      .add(new THREE.Vector3(0, HELMET_HEIGHT_METERS, 0))
      .add(forward.clone().multiplyScalar(COCKPIT_FORWARD_OFFSET_METERS));
    const lookAt = eye.clone().add(forward.multiplyScalar(LOOK_AHEAD_METERS));

    if (!this.initialized) {
      this.smoothedPosition.copy(eye);
      this.smoothedLookAt.copy(lookAt);
      this.initialized = true;
    } else {
      const alpha = 1 - Math.exp(-SMOOTHING_RATE * context.deltaSeconds);
      this.smoothedPosition.lerp(eye, alpha);
      this.smoothedLookAt.lerp(lookAt, alpha);
    }

    context.camera.position.copy(this.smoothedPosition);
    context.controls.target.copy(this.smoothedLookAt);
    context.controls.update();

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

function forwardFromHeading(heading: number, pitch = 0): THREE.Vector3 {
  const cosPitch = Math.cos(pitch);
  return new THREE.Vector3(
    Math.cos(heading) * cosPitch,
    Math.sin(pitch),
    Math.sin(heading) * cosPitch,
  ).normalize();
}
