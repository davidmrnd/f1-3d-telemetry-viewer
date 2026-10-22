import * as THREE from "three";

export class CarContactShadows {
  readonly mesh: THREE.InstancedMesh;
  private readonly map: THREE.CanvasTexture;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly matrix = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3(5.6, 2.15, 1);
  private readonly euler = new THREE.Euler(0, 0, 0, "YZX");
  private readonly planeRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

  constructor(count: number) {
    const canvas = document.createElement("canvas");
    canvas.width = 128; canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.translate(64, 32);
    ctx.scale(1, 0.5);
    const gradient = ctx.createRadialGradient(0, 0, 4, 0, 0, 60);
    gradient.addColorStop(0, "rgba(0,0,0,0.5)");
    gradient.addColorStop(0.45, "rgba(0,0,0,0.27)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient; ctx.fillRect(-64, -64, 128, 128);
    this.map = new THREE.CanvasTexture(canvas);
    this.material = new THREE.MeshBasicMaterial({ map: this.map, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  setCar(index: number, position: THREE.Vector3, heading: number, pitch: number) {
    this.position.copy(position); this.position.y += 0.022;
    this.euler.set(0, -heading, pitch);
    this.rotation.setFromEuler(this.euler);
    this.rotation.multiply(this.planeRotation);
    this.mesh.setMatrixAt(index, this.matrix.compose(this.position, this.rotation, this.scale));
  }

  finish(count: number) {
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.dispose(); this.mesh.geometry.dispose(); this.material.dispose(); this.map.dispose();
  }
}
