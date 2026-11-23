import { Mesh, type Group } from "three";
import type { DriverInfo, VehiclePose } from "../types";
import { carHeadingToRotationY, createCarVisual, disposeCarVisual } from "./car-models";

export class GhostCar {
  private readonly group;

  constructor(private readonly root: Group, driver: DriverInfo, length: number) {
    this.group = createCarVisual(driver, length).group;
    this.group.name = "ghost-car";
    this.group.visible = false;
    this.group.traverse(object => {
      if (!(object instanceof Mesh)) return;
      object.castShadow = false;
      object.receiveShadow = false;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        material.transparent = true;
        material.opacity *= 0.42;
        material.depthWrite = false;
      }
    });
    root.add(this.group);
  }

  update(pose: VehiclePose | null) {
    this.group.visible = pose !== null;
    if (pose) {
      this.group.position.set(pose.x, pose.y, pose.z);
      this.group.rotation.y = carHeadingToRotationY(pose.heading);
      this.group.rotation.x = -pose.pitch;
    }
  }

  dispose() {
    this.root.remove(this.group);
    disposeCarVisual(this.group);
  }
}
