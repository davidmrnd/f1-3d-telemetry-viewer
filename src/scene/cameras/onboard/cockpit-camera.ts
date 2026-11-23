import { Euler, Quaternion, Vector3, type PerspectiveCamera } from "three";
import type { VehiclePose } from "../../../types";
import { carHeadingToRotationY } from "../../car-models";

const orientation = new Euler(0, 0, 0, "YXZ");
const rotation = new Quaternion();
const direction = new Vector3();

export function placeCockpitCamera(
  camera: PerspectiveCamera, target: Vector3, pose: VehiclePose, lookAhead: number, level = false,
) {
  const yaw = carHeadingToRotationY(pose.heading);
  rotation.setFromEuler(orientation.set(-pose.pitch, yaw, 0));
  camera.position.set(0, 1.05, -0.15).applyQuaternion(rotation);
  camera.position.x += pose.x;
  camera.position.y += pose.y;
  camera.position.z += pose.z;
  camera.rotation.set(level ? 0 : pose.pitch, yaw + Math.PI, 0, "YXZ");
  direction.set(0, 0, -1).applyQuaternion(camera.quaternion);
  target.copy(camera.position).addScaledVector(direction, lookAhead);
}
