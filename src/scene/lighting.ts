import * as THREE from "three";
import type { GraphicsSettings } from "./graphics-settings";

export class RaceLighting {
  private readonly ambient = new THREE.AmbientLight("#e6eef4", 0.12);
  private readonly hemisphere = new THREE.HemisphereLight("#dce8ef", "#67705a", 0.8);
  private readonly sun = new THREE.DirectionalLight("#fff2dc", 2.5);
  private readonly fill = new THREE.DirectionalLight("#b7cde0", 0.22);
  private readonly sunOffset = new THREE.Vector3(110, 190, 80);
  private readonly focus = new THREE.Vector3();

  constructor(root: THREE.Group) {
    this.fill.position.set(-90, 80, -120);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 650;
    this.sun.shadow.bias = -0.00015;
    this.sun.shadow.normalBias = 0.035;
    root.add(this.ambient, this.hemisphere, this.sun, this.sun.target, this.fill);
  }

  apply(settings: GraphicsSettings, renderer: THREE.WebGLRenderer): string {
    const warm = settings.lighting === "warm";
    const cloudy = settings.lighting === "overcast";
    this.sun.color.set(warm ? "#ffd3a0" : "#fff2df");
    this.sun.intensity = cloudy ? 0.9 : warm ? 2.1 : 2.5;
    this.hemisphere.intensity = cloudy ? 1.3 : 0.8;
    this.ambient.intensity = settings.environment ? 0.12 : 0.32;
    this.sunOffset.set(110, warm ? 95 : 190, 80);
    const enabled = settings.shadows !== "off";
    renderer.shadowMap.enabled = enabled;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.sun.castShadow = enabled;
    const size = settings.shadows === "high" ? 2048 : settings.shadows === "medium" ? 1024 : 512;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    const half = settings.shadowDistance / 2;
    Object.assign(this.sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
    this.sun.shadow.camera.updateProjectionMatrix();
    renderer.shadowMap.needsUpdate = true;
    renderer.toneMappingExposure = settings.exposure;
    return warm ? "#d7cfbf" : cloudy ? "#bfcbd0" : "#c8d3d6";
  }

  update(position: THREE.Vector3) {
    const step = (this.sun.shadow.camera.right - this.sun.shadow.camera.left) / this.sun.shadow.mapSize.x;
    this.focus.copy(position);
    this.focus.x = Math.round(this.focus.x / step) * step;
    this.focus.z = Math.round(this.focus.z / step) * step;
    this.sun.target.position.copy(this.focus);
    this.sun.position.copy(this.focus).add(this.sunOffset);
  }
}
