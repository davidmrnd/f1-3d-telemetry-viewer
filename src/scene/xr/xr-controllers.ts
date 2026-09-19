import * as THREE from "three";
import type { WebGLRenderer } from "three";

export type XrControllerEvents = {
  onMenuButton?: () => void;
  onSelectStart?: (controllerIndex: number) => void;
  onSelectEnd?: (controllerIndex: number) => void;
};

export class XrControllers {
  readonly group = new THREE.Group();
  private readonly events: XrControllerEvents;
  private readonly controllers: THREE.XRTargetRaySpace[] = [];
  private readonly rays: THREE.Line[] = [];
  private readonly prevMenuPressed = [false, false];
  private readonly tempMatrix = new THREE.Matrix4();
  private readonly raycaster = new THREE.Raycaster();
  private readonly inputSources: (XRInputSource | null)[] = [null, null];

  constructor(renderer: WebGLRenderer, events: XrControllerEvents = {}) {
    this.events = events;
    this.group.name = "xr-controllers";

    for (let i = 0; i < 2; i += 1) {
      const controller = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      const ray = this.createRay();
      const index = i;

      controller.add(ray);
      controller.addEventListener("connected", (event) => {
        const data = event as THREE.Event & { data?: XRInputSource };
        this.inputSources[index] = data.data ?? null;
      });
      controller.addEventListener("disconnected", () => {
        this.inputSources[index] = null;
        this.prevMenuPressed[index] = false;
      });
      controller.addEventListener("selectstart", () => this.events.onSelectStart?.(index));
      controller.addEventListener("selectend", () => this.events.onSelectEnd?.(index));

      this.group.add(controller);
      this.group.add(grip);
      this.controllers.push(controller);
      this.rays.push(ray);
    }
  }

  setVisible(visible: boolean) {
    this.group.visible = visible;
  }

  update() {
    for (let i = 0; i < this.controllers.length; i += 1) {
      const gamepad = this.inputSources[i]?.gamepad;
      const pressed = Boolean(gamepad?.buttons[5]?.pressed);
      if (pressed && !this.prevMenuPressed[i]) {
        this.events.onMenuButton?.();
      }
      this.prevMenuPressed[i] = pressed;
    }
  }

  getRaycaster(controllerIndex: number): THREE.Raycaster | null {
    const controller = this.controllers[controllerIndex];
    if (!controller?.visible) {
      return null;
    }
    this.tempMatrix.identity().extractRotation(controller.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);
    return this.raycaster;
  }

  private createRay(): THREE.Line {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1.5),
    ]);
    const material = new THREE.LineBasicMaterial({
      color: 0x88c0ff,
      transparent: true,
      opacity: 0.85,
    });
    const line = new THREE.Line(geometry, material);
    line.name = "xr-ray";
    return line;
  }
}
