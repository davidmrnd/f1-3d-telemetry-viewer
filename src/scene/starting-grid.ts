import * as THREE from "three";
import type { StartingGridSlot } from "../types";
import { buildGridLateralOffsets } from "./car-placement";
import { TrackPath } from "./cameras/automatic/track-path";
import { metersToScene, type SceneTransform } from "./track-geometry";

export const GRID_FIRST_CAR_BEHIND_LINE_METERS = 10;
const GRID_POSITION_SPACING_METERS = 8;

export interface StartingGridReference {
  origin: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3;
}

export interface StartingGridPose {
  position: THREE.Vector3;
  heading: number;
  pitch: number;
}

export function buildStartingGridPoses(
  slots: StartingGridSlot[],
  reference: StartingGridReference,
  path: TrackPath,
  transform: SceneTransform,
): Map<number, StartingGridPose> {
  const offsets = buildGridLateralOffsets(slots);
  const poses = new Map<number, StartingGridPose>();
  const occupied = new Set<number>();
  const heading = Math.atan2(reference.tangent.z, reference.tangent.x);
  for (const slot of slots) {
    if (!Number.isInteger(slot.position) || slot.position < 1 || poses.has(slot.driverNumber) || occupied.has(slot.position)) continue;
    const behind = metersToScene(GRID_FIRST_CAR_BEHIND_LINE_METERS + (slot.position - 1) * GRID_POSITION_SPACING_METERS, transform);
    const position = reference.origin.clone().addScaledVector(reference.tangent, -behind)
      .addScaledVector(reference.normal, offsets.get(slot.driverNumber) ?? 0);
    position.y = path.projectPointPlanar(position)?.point.y ?? reference.origin.y;
    const front = path.projectPointPlanar(position.clone().addScaledVector(reference.tangent, 3));
    const rear = path.projectPointPlanar(position.clone().addScaledVector(reference.tangent, -3));
    const pitch = front && rear ? Math.atan2(front.point.y - rear.point.y, 6) : 0;
    poses.set(slot.driverNumber, { position, heading, pitch });
    occupied.add(slot.position);
  }
  return poses;
}

export function createStartingGridMarkings(
  poses: Map<number, StartingGridPose>,
  path: TrackPath,
  transform: SceneTransform,
): THREE.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const halfWidth = metersToScene(1.3, transform);
  const front = metersToScene(3, transform);
  const rear = metersToScene(-3.3, transform);
  const stroke = metersToScene(0.12, transform);
  const clearance = metersToScene(0.028, transform);

  for (const pose of poses.values()) {
    const tangent = new THREE.Vector3(Math.cos(pose.heading), 0, Math.sin(pose.heading));
    const lateral = new THREE.Vector3(-tangent.z, 0, tangent.x);
    const center = pose.position;
    const addStripe = (left: number, right: number, back: number, ahead: number) => {
      const first = positions.length / 3;
      for (const [x, z] of [[left, back], [left, ahead], [right, back], [right, ahead]]) {
        const point = center.clone().addScaledVector(lateral, x).addScaledVector(tangent, z);
        point.y = (path.projectPointPlanar(point)?.point.y ?? center.y) + clearance;
        positions.push(point.x, point.y, point.z);
      }
      indices.push(first, first + 2, first + 1, first + 1, first + 2, first + 3);
    };
    addStripe(-halfWidth, halfWidth, front - stroke, front);
    addStripe(-halfWidth, -halfWidth + stroke, rear, front - stroke);
    addStripe(halfWidth - stroke, halfWidth, rear, front - stroke);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: "#f4f4f4",
    roughness: 0.92,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -6,
    polygonOffsetUnits: -6,
  }));
  mesh.name = "starting-grid-markings";
  mesh.receiveShadow = true;
  mesh.renderOrder = 5;
  return mesh;
}
