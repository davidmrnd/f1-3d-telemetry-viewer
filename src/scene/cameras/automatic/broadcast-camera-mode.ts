import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ReplaySegment } from "../../../types";
import type { SceneTransform } from "../../track-geometry";
import { OnboardCameraMode } from "../onboard/onboard-camera-mode";
import type { CameraModeHandler, CameraUpdateContext } from "../types";
import { BroadcastDirector } from "./broadcast-director";
import { BroadcastFraming, setBroadcastFov } from "./broadcast-framing";
import { buildCornerCameraRig, type CornerCameraRig } from "./corner-camera-rig";
import type { BroadcastCarInput } from "./types";

export class BroadcastCameraMode implements CameraModeHandler {
  private shotRevision = 0;
  private onboardShot = false;

  getXrShot() {
    return { revision: this.shotRevision, onboard: this.onboardShot };
  }
  private rig: CornerCameraRig | null = null;
  private readonly director = new BroadcastDirector();
  private readonly framing = new BroadcastFraming();
  private readonly onboard = new OnboardCameraMode();
  private readonly previousPositions = new Map<number, THREE.Vector3>();
  private lastReplayTime: number | null = null;
  private activeShotId: number | null = null;
  private activeCamera: THREE.PerspectiveCamera | null = null;

  loadSegment(segment: ReplaySegment, transform: SceneTransform) {
    this.rig = buildCornerCameraRig(segment, transform);
    this.reset();
  }

  onActivate(controls: OrbitControls) {
    controls.enabled = false;
    this.reset();
  }

  onDeactivate() {
    if (this.activeCamera) {
      this.activeCamera.fov = 60;
      this.activeCamera.updateProjectionMatrix();
    }
    this.reset();
  }

  reset() {
    this.shotRevision += 1;
    this.director.reset();
    this.activeShotId = null;
    this.lastReplayTime = null;
    this.previousPositions.clear();
  }

  update(context: CameraUpdateContext): string {
    context.controls.enabled = false;
    const rig = this.rig;
    if (!rig || rig.cameras.length === 0) return "";
    this.activeCamera = context.camera;
    const replayDelta = this.lastReplayTime === null ? null : context.replayTimeMs - this.lastReplayTime;
    const seeked = replayDelta !== null && (replayDelta < 0 || replayDelta > Math.max(100, context.deltaSeconds * 3000));
    if (seeked) this.reset();
    this.lastReplayTime = context.replayTimeMs;
    const cars: BroadcastCarInput[] = context.placements.map(({ car, position, heading }) => {
      const id = car.driver.driverNumber;
      const previous = this.previousPositions.get(id);
      const velocity = new THREE.Vector3();
      if (previous && context.deltaSeconds > 0 && replayDelta !== null && replayDelta > 0 && !seeked) {
        velocity.subVectors(position, previous).divideScalar(context.deltaSeconds).clampLength(0, 350);
      } else if (!previous && replayDelta !== 0) {
        velocity.set(Math.cos(heading), 0, Math.sin(heading)).multiplyScalar(car.sample.speed / 3.6);
      }
      this.previousPositions.set(id, position.clone());
      return {
        driverNumber: id, position, racePosition: car.sample.position, velocity, heading,
        intervalToAhead: car.sample.intervalToAhead,
      };
    });
    const selection = this.director.select(
      rig.cameras, cars, rig.path, replayDelta === 0 ? 0 : context.deltaSeconds, context.eventDrivers,
    );
    if (!selection) return "";
    const cut = this.activeShotId !== selection.id;
    if (cut) this.shotRevision += 1;
    this.onboardShot = selection.kind === "onboard";
    this.activeShotId = selection.id;
    if (selection.kind === "onboard") {
      this.onboard.setFollowDriver(selection.subjectNumber);
      const label = this.onboard.update(context);
      setBroadcastFov(context, 74);
      return `${label} · ataque`;
    }
    if (selection.kind === "aerial") {
      this.framing.updateAerial(context, selection);
      return "Aérea fija · paso del pelotón";
    }
    const group = this.framing.updateTrackside(context, selection, cars, cut);
    const names = group.map((car) => context.placements.find((placement) =>
      placement.car.driver.driverNumber === car.driverNumber)?.car.driver.acronym).filter(Boolean).join(" · ");
    return `${selection.camera.label} · ${names}`;
  }
}
