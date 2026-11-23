import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { DriverInfo } from "../../../types";
import type { BaseCarPlacement } from "../../car-placement";
import type { CameraModeHandler, CameraUpdateContext } from "../types";
import { placeCockpitCamera } from "./cockpit-camera";

const LOOK_AHEAD_METERS = 50;

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
    placeCockpitCamera(context.camera, context.controls.target,
      { x: position.x, y: position.y, z: position.z, heading, pitch: car.pitch }, LOOK_AHEAD_METERS);

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
