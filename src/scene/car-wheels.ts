import * as THREE from "three";
import type { VehiclePose } from "../types";
import { angleDelta } from "./traffic/car-footprint";

const WHEEL_MESH_NAME = "model_3";
const MAX_STEERING_ANGLE = THREE.MathUtils.degToRad(32);
const FULL_TURN = 2 * Math.PI;

interface WheelPart {
  geometry: THREE.BufferGeometry;
  center: THREE.Vector3;
  radius: number;
  front: boolean;
}

const wheelPartsByGeometry = new WeakMap<THREE.BufferGeometry, WheelPart[]>();

export function prepareCarWheels(model: THREE.Group) {
  const source = model.getObjectByName(WHEEL_MESH_NAME);
  if (!(source instanceof THREE.Mesh)) return;

  const original: THREE.BufferGeometry = source.geometry;
  const positions = original.getAttribute("position");
  const index = original.index;
  if (!positions || !index) return;
  const indicesByWheel: number[][] = [[], [], [], []];
  for (let triangle = 0; triangle < index.count; triangle += 3) {
    const vertex = index.getX(triangle);
    const axle = positions.getY(vertex) > 0 ? 0 : 2;
    const side = positions.getX(vertex) > 0 ? 0 : 1;
    indicesByWheel[axle + side].push(vertex, index.getX(triangle + 1), index.getX(triangle + 2));
  }
  if (indicesByWheel.some(indices => indices.length === 0)) return;

  const point = new THREE.Vector3();
  const parts = indicesByWheel.map((indices, wheel): WheelPart => {
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(original.attributes)) {
      geometry.setAttribute(name, attribute);
    }
    geometry.setIndex(indices);

    const bounds = new THREE.Box3();
    for (const vertex of indices) bounds.expandByPoint(point.fromBufferAttribute(positions, vertex));
    geometry.boundingBox = bounds;
    geometry.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
    return {
      geometry,
      center: bounds.getCenter(new THREE.Vector3()),
      radius: (bounds.max.z - bounds.min.z) / 2,
      front: wheel < 2,
    };
  });
  wheelPartsByGeometry.set(original, parts);
}

export class CarWheelAnimation {
  private readonly rig = new THREE.Group();
  private readonly previousPosition = new THREE.Vector3();
  private previousTime: number | null = null;
  private readonly wheels: { pivot: THREE.Group; mesh: THREE.Mesh; radius: number; front: boolean }[];
  private readonly wheelbase: number;

  static create(model: THREE.Group): CarWheelAnimation | null {
    const source = model.getObjectByName(WHEEL_MESH_NAME);
    if (!(source instanceof THREE.Mesh) || !source.parent) return null;
    const parts = wheelPartsByGeometry.get(source.geometry);
    if (!parts) return null;
    return new CarWheelAnimation(source, parts);
  }

  private constructor(private readonly source: THREE.Mesh, parts: WheelPart[]) {
    const scale = source.getWorldScale(new THREE.Vector3()).x;
    this.wheelbase = Math.abs(parts[0].center.y - parts[2].center.y) * scale;
    this.rig.name = "car-wheels";
    this.rig.position.copy(source.position);
    this.rig.quaternion.copy(source.quaternion);
    this.rig.scale.copy(source.scale);
    this.rig.matrixAutoUpdate = false;
    this.rig.updateMatrix();

    this.wheels = parts.map(({ geometry, center, radius, front }) => {
      const mesh = new THREE.Mesh(geometry, source.material);
      mesh.position.copy(center).negate();
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();

      const pivot = new THREE.Group();
      pivot.name = front ? "front-wheel" : "rear-wheel";
      pivot.rotation.order = "ZXY";
      pivot.position.copy(center);
      pivot.matrixAutoUpdate = false;
      pivot.updateMatrix();
      pivot.add(mesh);
      this.rig.add(pivot);
      return { pivot, mesh, radius: radius * scale, front };
    });
  }

  resetMotion() {
    this.previousTime = null;
  }

  hide() {
    this.rig.removeFromParent();
    this.source.visible = true;
    this.resetMotion();
  }

  estimateSteering(before: VehiclePose | null, after: VehiclePose | null): number {
    if (!before || !after) return 0;
    const yaw = angleDelta(before.heading, after.heading);
    const heading = before.heading + yaw / 2;
    const travel = (after.x - before.x) * Math.cos(heading) + (after.z - before.z) * Math.sin(heading);
    return Math.abs(travel) > 0.25 ? Math.atan(this.wheelbase * yaw / travel) : 0;
  }

  update(time: number, position: THREE.Vector3, yaw: number, pitch: number, steering: number) {
    if (!this.rig.parent) {
      for (const { mesh } of this.wheels) {
        mesh.material = this.source.material;
        mesh.castShadow = this.source.castShadow;
        mesh.receiveShadow = this.source.receiveShadow;
        mesh.userData.graphicsVariants = this.source.userData.graphicsVariants;
      }
      this.source.parent?.add(this.rig);
      this.source.visible = false;
    }
    const elapsed = this.previousTime === null ? 0 : time - this.previousTime;
    let travel = 0;
    if (elapsed > 0 && elapsed <= 500) {
      const dx = position.x - this.previousPosition.x;
      const dy = position.y - this.previousPosition.y;
      const dz = position.z - this.previousPosition.z;
      const groundTravel = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      travel = groundTravel * Math.cos(pitch) + dy * Math.sin(pitch);
    }
    this.previousTime = time;
    this.previousPosition.copy(position);

    const steer = THREE.MathUtils.clamp(steering, -MAX_STEERING_ANGLE, MAX_STEERING_ANGLE);
    for (const { pivot, radius, front } of this.wheels) {
      const rotation = pivot.rotation;
      const roll = (rotation.x + travel / radius) % FULL_TURN;
      const turn = front ? steer : 0;
      if (rotation.x === roll && rotation.z === turn) continue;
      rotation.set(roll, 0, turn);
      pivot.updateMatrix();
    }
  }
}
