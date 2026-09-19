import * as THREE from "three";

export class XrRig {
  readonly worldRoot = new THREE.Group();
  private readonly desiredPosition = new THREE.Vector3();
  private readonly desiredQuaternion = new THREE.Quaternion();
  private readonly matrix = new THREE.Matrix4();
  private readonly invertMatrix = new THREE.Matrix4();
  private active = false;

  constructor() {
    this.worldRoot.name = "xr-world-root";
    this.worldRoot.matrixAutoUpdate = false;
  }

  setActive(active: boolean) {
    this.active = active;
    if (!active) {
      this.reset();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  applyDesiredPose(position: THREE.Vector3, quaternion: THREE.Quaternion) {
    this.desiredPosition.copy(position);
    this.desiredQuaternion.copy(quaternion);
    if (!this.active) {
      return;
    }
    this.matrix.compose(this.desiredPosition, this.desiredQuaternion, new THREE.Vector3(1, 1, 1));
    this.invertMatrix.copy(this.matrix).invert();
    this.worldRoot.matrix.copy(this.invertMatrix);
    this.worldRoot.matrixWorldNeedsUpdate = true;
  }

  applyDesiredCamera(camera: THREE.PerspectiveCamera) {
    camera.updateMatrixWorld(true);
    camera.matrixWorld.decompose(
      this.desiredPosition,
      this.desiredQuaternion,
      new THREE.Vector3(),
    );
    this.applyDesiredPose(this.desiredPosition, this.desiredQuaternion);
  }

  getDesiredPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.desiredPosition);
  }

  getDesiredQuaternion(target = new THREE.Quaternion()): THREE.Quaternion {
    return target.copy(this.desiredQuaternion);
  }

  reset() {
    this.worldRoot.matrix.identity();
    this.worldRoot.matrixWorldNeedsUpdate = true;
  }
}
