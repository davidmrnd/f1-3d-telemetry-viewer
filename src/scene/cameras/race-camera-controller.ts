import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ReplaySegment } from "../../types";
import type { BaseCarPlacement } from "../car-placement";
import type { SceneTransform } from "../track-geometry";
import { BroadcastCameraMode } from "./automatic/broadcast-camera-mode";
import type { TrackPath } from "./automatic/track-path";
import { OrbitCameraMode } from "./manual/orbit-camera-mode";
import { OnboardCameraMode } from "./onboard/onboard-camera-mode";
import type { CameraMode, CameraModeHandler } from "./types";

export class RaceCameraController {
  private mode: CameraMode = "broadcast";
  private readonly broadcastMode = new BroadcastCameraMode();
  private readonly orbitMode = new OrbitCameraMode();
  private readonly onboardMode = new OnboardCameraMode();
  private activeLabel = "";

  private readonly handlers: Record<CameraMode, CameraModeHandler> = {
    broadcast: this.broadcastMode,
    orbit: this.orbitMode,
    onboard: this.onboardMode,
  };

  loadSegment(segment: ReplaySegment, transform: SceneTransform, path: TrackPath) {
    this.broadcastMode.loadSegment(segment, transform, path);
    this.onboardMode.setDrivers(segment.drivers);
    this.handlers[this.mode].reset();
    this.activeLabel = "";
  }

  setMode(mode: CameraMode, controls: OrbitControls) {
    if (mode !== this.mode) {
      this.handlers[this.mode].onDeactivate();
    }

    this.mode = mode;
    this.handlers[mode].onActivate(controls);
    this.activeLabel = "";
  }

  getMode(): CameraMode {
    return this.mode;
  }

  getXrShot() {
    return this.broadcastMode.getXrShot();
  }

  getActiveLabel(): string {
    return this.activeLabel;
  }

  setFollowDriver(driverNumber: number) {
    this.onboardMode.setFollowDriver(driverNumber);
  }

  getFollowDriver(): number | null {
    return this.onboardMode.getFollowDriver();
  }

  getSubjectNumber() {
    if (this.mode === "onboard") return this.onboardMode.getSubjectNumber();
    return this.mode === "broadcast" ? this.broadcastMode.getSubjectNumber() : null;
  }

  isOnboardShot() {
    return this.mode === "onboard" || (this.mode === "broadcast" && this.broadcastMode.getXrShot().onboard);
  }

  update(
    placements: BaseCarPlacement[],
    camera: Parameters<CameraModeHandler["update"]>[0]["camera"],
    controls: OrbitControls,
    deltaSeconds: number,
    xrPresenting = false,
    replayTimeMs = 0,
    eventDrivers: readonly number[] = [],
  ) {
    this.activeLabel = this.handlers[this.mode].update({
      placements,
      camera,
      controls,
      deltaSeconds,
      xrPresenting,
      replayTimeMs,
      eventDrivers,
    });
  }
}
