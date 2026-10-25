import * as THREE from "three";

export function xrStick(gamepad: Gamepad | undefined): [number, number] {
  const axes = gamepad?.axes ?? [];
  const offset = axes.length >= 4 ? 2 : 0;
  const deadzone = (value: number) => Math.abs(value) < 0.18 ? 0 : Math.sign(value) * (Math.abs(value) - 0.18) / 0.82;
  return [deadzone(axes[offset] ?? 0), deadzone(axes[offset + 1] ?? 0)];
}

export class XrFlight {
  private readonly velocity = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly wish = new THREE.Vector3();
  private turnReady = true;

  reset() {
    this.velocity.set(0, 0, 0);
    this.turnReady = true;
  }

  update(camera: THREE.PerspectiveCamera, head: THREE.Camera, sources: readonly (XRInputSource | null)[], delta: number, blocked: boolean): number {
    if (blocked) { this.reset(); return 0; }
    const left = sources.find((source) => source?.handedness === "left")?.gamepad;
    const right = sources.find((source) => source?.handedness === "right")?.gamepad;
    const [x, y] = xrStick(left);
    const [turn, rise] = xrStick(right);
    const dt = THREE.MathUtils.clamp(delta, 0, 0.05);
    let yaw = 0;
    if (Math.abs(turn) < 0.3) this.turnReady = true;
    if (Math.abs(turn) > 0.7 && this.turnReady) {
      yaw = -Math.sign(turn) * Math.PI / 6;
      camera.rotateY(yaw);
      this.turnReady = false;
    }
    this.forward.set(0, 0, -1).transformDirection(head.matrixWorld);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 0.001) this.forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    this.forward.normalize();
    this.right.crossVectors(this.forward, THREE.Object3D.DEFAULT_UP).normalize();
    this.wish.copy(this.forward).multiplyScalar(-y).addScaledVector(this.right, x);
    this.wish.y = -rise;
    if (this.wish.lengthSq() > 1) this.wish.normalize();
    const boost = left?.buttons[1]?.pressed || right?.buttons[1]?.pressed;
    this.wish.multiplyScalar(boost ? 45 : 12);
    this.velocity.lerp(this.wish, 1 - Math.exp(-10 * dt));
    if (!left && !right) this.velocity.set(0, 0, 0);
    camera.position.addScaledVector(this.velocity, dt);
    return yaw;
  }
}
