import * as THREE from "three";
import { createXrPanel, createXrWindowBar } from "./xr-panel";

export class XrFloatingWindow {
  readonly surface: ReturnType<typeof createXrPanel>;
  readonly bar: ReturnType<typeof createXrWindowBar>;

  constructor(parent: THREE.Object3D, width: number, height: number, meters: number, name: string, surface?: ReturnType<typeof createXrPanel>) {
    this.surface = surface ?? createXrPanel(width, height, meters, name);
    this.bar = createXrWindowBar(this.surface, width, height, meters, `${name}-handle`);
    parent.add(this.surface.mesh);
  }

  place(head: THREE.Camera, offset: number) {
    const yaw = new THREE.Euler().setFromQuaternion(head.quaternion, "YXZ").y;
    const mesh = this.surface.mesh;
    mesh.position.set(offset, -.04, -1.05).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw).add(head.position);
    mesh.parent?.worldToLocal(mesh.position);
    mesh.lookAt(head.position);
    mesh.visible = true;
  }

  owns(object: THREE.Object3D) { return object === this.surface.mesh || object === this.bar.mesh; }

  targets() { return this.surface.mesh.visible ? [this.surface.mesh, this.bar.mesh] : []; }

  close() { this.surface.mesh.visible = false; }

  dispose() {
    this.surface.mesh.removeFromParent();
    for (const surface of [this.surface, this.bar]) {
      surface.mesh.geometry.dispose(); surface.mesh.material.dispose(); surface.texture.dispose();
    }
  }
}
