import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CameraModeHandler, CameraUpdateContext } from "../types";

/** Vista libre con OrbitControls (tercera persona / previsualización). */
export class OrbitCameraMode implements CameraModeHandler {
  onActivate(controls: OrbitControls) {
    controls.enabled = true;
  }

  onDeactivate() {}

  reset() {}

  update(_context: CameraUpdateContext): string {
    return "";
  }
}
