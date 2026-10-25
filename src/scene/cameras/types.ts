import type * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { BaseCarPlacement } from "../car-placement";

export type CameraMode = "broadcast" | "orbit" | "onboard";

export const CAMERA_MODE_LABELS: Record<CameraMode, string> = {
  broadcast: "Retransmisión",
  orbit: "Libre (vuelo)",
  onboard: "On-board piloto",
};

export interface CameraUpdateContext {
  placements: BaseCarPlacement[];
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  deltaSeconds: number;
  replayTimeMs: number;
  eventDrivers: readonly number[];
  xrPresenting?: boolean;
}

export interface CameraModeHandler {
  onActivate(controls: OrbitControls): void;
  onDeactivate(): void;
  reset(): void;
  update(context: CameraUpdateContext): string;
}
