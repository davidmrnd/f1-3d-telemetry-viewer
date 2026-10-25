import * as THREE from "three";

export class XrRig {
  readonly worldRoot = new THREE.Group();
  readonly viewerRoot = new THREE.Group();
  private readonly reference = new THREE.Matrix4();
  private calibrated = false;
  private readonly desiredPosition = new THREE.Vector3();
  private readonly desiredQuaternion = new THREE.Quaternion();
  private readonly matrix = new THREE.Matrix4();
  private readonly unitScale = new THREE.Vector3(1, 1, 1);
  private readonly cameraScale = new THREE.Vector3();
  private active = false;

  constructor() {
    this.worldRoot.name = "xr-world-root";
    this.worldRoot.matrixAutoUpdate = false;
    this.viewerRoot.name = "xr-viewer-root";
    this.viewerRoot.matrixAutoUpdate = false;
    this.viewerRoot.visible = false;
  }

  setActive(active: boolean) {
    this.active = active;
    this.viewerRoot.visible = active;
    this.calibrated = false;
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
    this.matrix.compose(this.desiredPosition, this.desiredQuaternion, this.unitScale);
    this.viewerRoot.matrix.multiplyMatrices(this.matrix, this.reference);
    this.viewerRoot.matrixWorldNeedsUpdate = true;
    this.viewerRoot.updateMatrixWorld(true);
  }

  applyDesiredCamera(camera: THREE.PerspectiveCamera) {
    camera.updateMatrixWorld(true);
    camera.matrixWorld.decompose(
      this.desiredPosition,
      this.desiredQuaternion,
      this.cameraScale,
    );
    this.applyDesiredPose(this.desiredPosition, this.desiredQuaternion);
  }

  getDesiredPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.desiredPosition);
  }

  calibrate(head: THREE.Camera) {
    if (this.calibrated) return;
    const yaw = new THREE.Euler().setFromQuaternion(head.quaternion, "YXZ").y;
    this.reference.compose(head.position, new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), new THREE.Vector3(1, 1, 1)).invert();
    this.calibrated = true;
  }

  recenter() {
    this.calibrated = false;
  }

  alignHeading(head: THREE.Camera) {
    if (!this.calibrated) { this.calibrate(head); return; }
    const origin = new THREE.Vector3().setFromMatrixPosition(this.reference.clone().invert());
    const yaw = new THREE.Euler().setFromQuaternion(head.quaternion, "YXZ").y;
    this.reference.compose(origin, new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), new THREE.Vector3(1, 1, 1)).invert();
  }

  getDesiredQuaternion(target = new THREE.Quaternion()): THREE.Quaternion {
    return target.copy(this.desiredQuaternion);
  }

  reset() {
    this.worldRoot.matrix.identity();
    this.worldRoot.matrixWorldNeedsUpdate = true;
    this.viewerRoot.matrix.identity();
    this.viewerRoot.matrixWorldNeedsUpdate = true;
    this.calibrated = false;
  }
}
