import type { WebGLRenderer } from "three";

export class XrControllers {
  private readonly sources: (XRInputSource | null)[] = [null, null];
  private cameraPressed = false;
  private driverPressed = false;
  private playPressed = false;
  private active = false;

  constructor(renderer: WebGLRenderer, private readonly actions: { onCameraMode: () => void; onNextDriver: () => void; onTogglePlay?: () => void }) {
    for (let index = 0; index < 2; index++) {
      const controller = renderer.xr.getController(index);
      controller.addEventListener("connected", event => { this.sources[index] = event.data; });
      controller.addEventListener("disconnected", () => { this.sources[index] = null; });
    }
  }

  setActive(active: boolean) {
    this.active = active;
    this.cameraPressed = false;
    this.driverPressed = false;
    this.playPressed = false;
  }

  update() {
    if (!this.active) return;
    const camera = this.sources.some(source => source?.gamepad?.buttons[5]?.pressed);
    const driver = this.sources.some(source => source?.gamepad?.buttons[4]?.pressed);
    const play = Boolean(this.sources.find(source => source?.handedness === "right")?.gamepad?.buttons[0]?.pressed);
    if (camera && !this.cameraPressed) this.actions.onCameraMode();
    if (driver && !this.driverPressed) this.actions.onNextDriver();
    if (play && !this.playPressed) this.actions.onTogglePlay?.();
    this.cameraPressed = camera;
    this.driverPressed = driver;
    this.playPressed = play;
  }

  getInputSources(): readonly (XRInputSource | null)[] { return this.sources; }
}
