import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export class DistantCars {
  readonly group = new THREE.Group();
  private readonly body: THREE.InstancedMesh;
  private readonly tyres: THREE.InstancedMesh;
  private readonly bodyMaterial = new THREE.MeshLambertMaterial({ color: "#ffffff" });
  private readonly tyreMaterial = new THREE.MeshLambertMaterial({ color: "#16191c" });

  constructor(count: number) {
    const box = (x: number, y: number, z: number, px: number, py: number, pz: number) =>
      new THREE.BoxGeometry(x, y, z).translate(px, py, pz);
    const bodyParts = [box(1.1, 0.4, 3.1, 0, 0.42, -0.2), box(0.4, 0.22, 1.8, 0, 0.38, 1.35),
      box(1.9, 0.1, 0.45, 0, 0.22, 2.45), box(1.8, 0.14, 0.5, 0, 0.85, -2.2),
      box(0.35, 0.35, 1.1, 0, 0.7, -0.8)];
    const blackParts: THREE.BufferGeometry[] = [box(0.6, 0.18, 0.8, 0, 0.72, 0.05)];
    for (const x of [-0.82, 0.82]) for (const z of [-1.65, 1.65]) {
      blackParts.push(new THREE.CylinderGeometry(0.36, 0.36, 0.38, 12).rotateZ(Math.PI / 2).translate(x, 0.36, z));
    }
    this.body = new THREE.InstancedMesh(mergeGeometries(bodyParts), this.bodyMaterial, count);
    this.tyres = new THREE.InstancedMesh(mergeGeometries(blackParts), this.tyreMaterial, count);
    [...bodyParts, ...blackParts].forEach((geometry) => geometry.dispose());
    for (const mesh of [this.body, this.tyres]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
    }
    this.group.add(this.body, this.tyres);
    this.finish(0);
  }

  setCar(index: number, matrix: THREE.Matrix4, color: THREE.Color) {
    this.body.setMatrixAt(index, matrix);
    this.tyres.setMatrixAt(index, matrix);
    this.body.setColorAt(index, color);
  }

  finish(count: number) {
    for (const mesh of [this.body, this.tyres]) {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = count > 0;
    }
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
  }

  dispose() {
    for (const mesh of [this.body, this.tyres]) { mesh.dispose(); mesh.geometry.dispose(); }
    this.bodyMaterial.dispose(); this.tyreMaterial.dispose();
  }
}
