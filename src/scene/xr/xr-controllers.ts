import * as THREE from "three";
import type { WebGLRenderer } from "three";

export class XrControllers {
  readonly group = new THREE.Group();
  private readonly rays: THREE.Group[] = [];
  private readonly grips: THREE.Group[] = [];
  private readonly sources: (XRInputSource | null)[] = [null, null];
  private cameraPressed = false;
  private driverPressed = false;
  private playPressed = false;
  private menuPressed = false;
  private active = false;

  constructor(renderer: WebGLRenderer, private readonly actions: {
    onCameraMode: () => void; onNextDriver: () => void; onTogglePlay?: () => void;
    onToggleMenu?: () => void; onSelect?: () => boolean;
  }) {
    for (let index = 0; index < 2; index++) {
      const controller = renderer.xr.getController(index);
      const grip = renderer.xr.getControllerGrip(index);
      this.rays.push(controller); this.grips.push(grip);
      this.group.add(controller, grip);
      controller.addEventListener("connected", event => { this.sources[index] = event.data; });
      controller.addEventListener("disconnected", () => { this.sources[index] = null; });
    }
  }

  setActive(active: boolean) {
    this.active = active;
    this.cameraPressed = false;
    this.driverPressed = false;
    this.playPressed = false;
    this.menuPressed = false;
    this.group.visible = active;
  }

  update() {
    if (!this.active) return;
    const camera = this.sources.some(source => source?.gamepad?.buttons[5]?.pressed);
    const driver = this.sources.some(source => source?.gamepad?.buttons[4]?.pressed);
    const play = Boolean(this.sources.find(source => source?.handedness === "right")?.gamepad?.buttons[0]?.pressed);
    const menu = Boolean(this.sources.find(source => source?.handedness === "left")?.gamepad?.buttons[3]?.pressed);
    if (menu && !this.menuPressed) this.actions.onToggleMenu?.();
    if (camera && !this.cameraPressed) this.actions.onCameraMode();
    if (driver && !this.driverPressed) this.actions.onNextDriver();
    if (play && !this.playPressed && !this.actions.onSelect?.()) this.actions.onTogglePlay?.();
    this.cameraPressed = camera;
    this.driverPressed = driver;
    this.playPressed = play;
    this.menuPressed = menu;
  }

  getInputSources(): readonly (XRInputSource | null)[] { return this.sources; }

  getGrip(hand: XRHandedness): THREE.Group | null {
    const index = this.sources.findIndex(source => source?.handedness === hand);
    return index >= 0 && this.grips[index].visible ? this.grips[index] : null;
  }

  getTargetRay(hand: XRHandedness): THREE.Group | null {
    const index = this.sources.findIndex(source => source?.handedness === hand);
    return index >= 0 && this.rays[index].visible ? this.rays[index] : null;
  }
}
