import * as THREE from "three";

const TELEPORT_EYE_HEIGHT = 1.7;
const DOWN = new THREE.Vector3(0, -1, 0);

export function tryTeleportAlongRay(
  raycaster: THREE.Raycaster,
  camera: THREE.PerspectiveCamera,
  targets: THREE.Object3D[],
  maxDistance = 40,
): boolean {
  raycaster.far = maxDistance;
  const hits = raycaster.intersectObjects(targets, true);
  const hit = hits.find((entry) => {
    const normal = entry.face?.normal;
    if (!normal) {
      return entry.point.y < 2.5;
    }
    const worldNormal = normal.clone();
    if (entry.object instanceof THREE.Mesh) {
      worldNormal.transformDirection(entry.object.matrixWorld);
    }
    return worldNormal.dot(DOWN) < -0.35 || entry.point.y < 1.5;
  });

  if (!hit) {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const point = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, point)) {
      return false;
    }
    if (point.distanceTo(raycaster.ray.origin) > maxDistance) {
      return false;
    }
    placeCameraAt(camera, point);
    return true;
  }

  placeCameraAt(camera, hit.point);
  return true;
}

function placeCameraAt(camera: THREE.PerspectiveCamera, groundPoint: THREE.Vector3) {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) {
    forward.set(0, 0, -1);
  } else {
    forward.normalize();
  }

  camera.position.set(groundPoint.x, groundPoint.y + TELEPORT_EYE_HEIGHT, groundPoint.z);
  const lookTarget = camera.position.clone().add(forward);
  camera.lookAt(lookTarget);
  camera.updateMatrixWorld(true);
}
