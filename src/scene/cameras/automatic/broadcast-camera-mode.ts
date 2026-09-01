import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ReplaySegment } from "../../../types";
import type { SceneTransform } from "../../track-geometry";
import type { CameraModeHandler, CameraUpdateContext } from "../types";
import { BroadcastDirector } from "./broadcast-director";
import { buildCornerCameraRig, type CornerCameraRig } from "./corner-camera-rig";

const SMOOTHING_RATE = 5.5;

export class BroadcastCameraMode implements CameraModeHandler {
  private rig: CornerCameraRig | null = null;
  private readonly director = new BroadcastDirector();
  private readonly smoothedPosition = new THREE.Vector3();
  private readonly smoothedLookAt = new THREE.Vector3();
  private smoothedForCameraId: number | null = null;

  loadSegment(segment: ReplaySegment, transform: SceneTransform) {
    this.rig = buildCornerCameraRig(segment, transform);
    this.reset();
  }

  onActivate(controls: OrbitControls) {
    controls.enabled = false;
    this.smoothedForCameraId = null;
  }

  onDeactivate() {}

  reset() {
    this.director.reset();
    this.smoothedForCameraId = null;
  }

  update(context: CameraUpdateContext): string {
    const rig = this.rig;
    if (!rig || rig.cameras.length === 0) {
      context.controls.enabled = false;
      return "";
    }

    context.controls.enabled = false;

    const cars = context.placements.map(({ car, position }) => ({
      driverNumber: car.driver.driverNumber,
      position,
      racePosition: car.sample.position,
    }));

    const selection = this.director.select(rig.cameras, cars, context.deltaSeconds);
    if (!selection) {
      return "";
    }

    const { camera: selected } = selection;

    if (this.smoothedForCameraId !== selected.id) {
      this.smoothedPosition.copy(selected.position);
      this.smoothedLookAt.copy(selected.lookAt);
      this.smoothedForCameraId = selected.id;
    } else {
      const alpha = 1 - Math.exp(-SMOOTHING_RATE * context.deltaSeconds);
      this.smoothedPosition.lerp(selected.position, alpha);
      this.smoothedLookAt.lerp(selected.lookAt, alpha);
    }

    context.camera.position.copy(this.smoothedPosition);
    context.controls.target.copy(this.smoothedLookAt);
    context.controls.update();

    return selected.label;
  }
}
