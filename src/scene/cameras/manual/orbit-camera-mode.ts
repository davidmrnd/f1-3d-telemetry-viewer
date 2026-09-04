import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CameraModeHandler, CameraUpdateContext } from "../types";

const WALK_SPEED_MPS = 28;
const SPRINT_SPEED_MPS = 70;

type MoveKeys = {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  sprint: boolean;
};

export class OrbitCameraMode implements CameraModeHandler {
  private orbit: OrbitControls | null = null;
  private pointer: PointerLockControls | null = null;
  private active = false;
  private readonly keys: MoveKeys = {
    forward: false,
    back: false,
    left: false,
    right: false,
    up: false,
    down: false,
    sprint: false,
  };
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly wish = new THREE.Vector3();

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (!this.active) return;
    this.applyKey(event.code, true);
    if (this.shouldCaptureKey(event.code)) {
      event.preventDefault();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    if (!this.active) return;
    this.applyKey(event.code, false);
  };

  private readonly onCanvasClick = () => {
    if (!this.active || !this.pointer || this.pointer.isLocked) return;
    this.pointer.lock();
  };

  onActivate(controls: OrbitControls) {
    this.orbit = controls;
    controls.enabled = false;
    this.active = true;
    this.resetKeys();
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  onDeactivate() {
    this.active = false;
    this.resetKeys();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.pointer?.unlock();
    this.disposePointer();
    if (this.orbit) {
      this.orbit.enabled = true;
      this.orbit.update();
    }
  }

  reset() {
    this.resetKeys();
  }

  update(context: CameraUpdateContext): string {
    this.ensurePointer(context);

    if (!this.pointer?.isLocked) {
      return "Libre · clic para mirar · WASD / Espacio / Shift";
    }

    const speed =
      (this.keys.sprint ? SPRINT_SPEED_MPS : WALK_SPEED_MPS) * context.deltaSeconds;
    const camera = context.camera;

    camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) {
      this.forward.set(0, 0, -1);
    } else {
      this.forward.normalize();
    }
    this.right.crossVectors(this.forward, camera.up).normalize();

    this.wish.set(0, 0, 0);
    if (this.keys.forward) this.wish.add(this.forward);
    if (this.keys.back) this.wish.sub(this.forward);
    if (this.keys.right) this.wish.add(this.right);
    if (this.keys.left) this.wish.sub(this.right);
    if (this.wish.lengthSq() > 0) {
      this.wish.normalize().multiplyScalar(speed);
      camera.position.add(this.wish);
    }

    if (this.keys.up) camera.position.y += speed;
    if (this.keys.down) camera.position.y -= speed;

    this.orbit?.target.copy(camera.position).add(this.forward);

    return "Libre · Espacio subir · Shift bajar · Ctrl correr";
  }

  private ensurePointer(context: CameraUpdateContext) {
    const dom = context.controls.domElement;
    if (!dom) return;
    if (this.pointer && this.pointer.domElement === dom) {
      return;
    }
    this.disposePointer();
    this.pointer = new PointerLockControls(context.camera, dom);
    dom.addEventListener("click", this.onCanvasClick);
  }

  private disposePointer() {
    if (!this.pointer) return;
    const dom = this.pointer.domElement;
    if (dom) {
      dom.removeEventListener("click", this.onCanvasClick);
    }
    this.pointer.dispose();
    this.pointer = null;
  }

  private applyKey(code: string, pressed: boolean) {
    switch (code) {
      case "KeyW":
      case "ArrowUp":
        this.keys.forward = pressed;
        break;
      case "KeyS":
      case "ArrowDown":
        this.keys.back = pressed;
        break;
      case "KeyA":
      case "ArrowLeft":
        this.keys.left = pressed;
        break;
      case "KeyD":
      case "ArrowRight":
        this.keys.right = pressed;
        break;
      case "Space":
        this.keys.up = pressed;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.keys.down = pressed;
        break;
      case "ControlLeft":
      case "ControlRight":
        this.keys.sprint = pressed;
        break;
      default:
        break;
    }
  }

  private shouldCaptureKey(code: string): boolean {
    return (
      code === "Space" ||
      code === "KeyW" ||
      code === "KeyA" ||
      code === "KeyS" ||
      code === "KeyD" ||
      code === "ArrowUp" ||
      code === "ArrowDown" ||
      code === "ArrowLeft" ||
      code === "ArrowRight" ||
      code === "ShiftLeft" ||
      code === "ShiftRight"
    );
  }

  private resetKeys() {
    this.keys.forward = false;
    this.keys.back = false;
    this.keys.left = false;
    this.keys.right = false;
    this.keys.up = false;
    this.keys.down = false;
    this.keys.sprint = false;
  }
}
