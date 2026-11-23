import type { PerspectiveCamera, Vector3 } from "three";
import type { VehiclePose } from "../../types";
import { placeCockpitCamera } from "./onboard/cockpit-camera";

export class DrivingCamera {
  private heading = 0;
  private wasCockpit = false;

  update(car: VehiclePose, camera: PerspectiveCamera, target: Vector3, dt: number, snap: boolean, cockpit: boolean, vr: boolean) {
    const fov = cockpit ? 72 : 61;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    if (cockpit) {
      this.wasCockpit = true;
      placeCockpitCamera(camera, target, car, 15, vr);
      return;
    }
    const yaw = car.heading - this.heading;
    this.heading = snap || this.wasCockpit ? car.heading
      : this.heading + Math.atan2(Math.sin(yaw), Math.cos(yaw)) * (1 - Math.exp(-dt * 7));
    this.wasCockpit = false;
    const forwardX = Math.cos(this.heading);
    const forwardZ = Math.sin(this.heading);
    camera.position.set(car.x - forwardX * 8.7, car.y + 3.5 - Math.sin(car.pitch) * 5, car.z - forwardZ * 8.7);
    target.set(car.x + forwardX * 15, car.y + 1.2 + Math.sin(car.pitch) * 8, car.z + forwardZ * 15);
    camera.lookAt(target);
  }
}
