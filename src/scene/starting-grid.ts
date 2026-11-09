import * as THREE from "three";
import type { StartingGridSlot } from "../types";
import { buildGridLateralOffsets } from "./car-placement";
import type { TrackPath } from "./cameras/automatic/track-path";
import { crossSectionPoint, type TrackCrossSection } from "./track/ribbon";
import { metersToScene, type SceneTransform } from "./track-geometry";

export const GRID_FIRST_CAR_BEHIND_LINE_METERS = 10;
const GRID_POSITION_SPACING_METERS = 8;
const GRID_MARKING_FRONT_METERS = 3;
const GRID_MARKING_REAR_METERS = -3.3;

export interface StartingGridPose {
  position: THREE.Vector3;
  heading: number;
  pitch: number;
  distance: number;
  offset: number;
}

export class StartingGridTrack {
  constructor(
    readonly path: TrackPath,
    private readonly sections: TrackCrossSection[],
    readonly direction: number,
  ) {}

  pointAt(distance: number, offset: number): THREE.Vector3 {
    const { index, fraction } = this.path.segmentAt(distance);
    const lateral = offset * this.direction;
    const start = crossSectionPoint(this.sections[index], lateral);
    const end = crossSectionPoint(this.sections[(index + 1) % this.sections.length], lateral);
    return start.lerp(end, fraction);
  }

  poseAt(distance: number, offset: number): StartingGridPose {
    const position = this.pointAt(distance, offset);
    const front = this.pointAt(distance + 1.5 * this.direction, offset);
    const rear = this.pointAt(distance - 1.5 * this.direction, offset);
    const travel = front.sub(rear);
    return {
      position,
      heading: Math.atan2(travel.z, travel.x),
      pitch: Math.atan2(travel.y, Math.hypot(travel.x, travel.z)),
      distance,
      offset,
    };
  }
}

export function buildStartingGridPoses(
  slots: StartingGridSlot[],
  startDistance: number,
  track: StartingGridTrack,
  transform: SceneTransform,
): Map<number, StartingGridPose> {
  const offsets = buildGridLateralOffsets(slots);
  const poses = new Map<number, StartingGridPose>();
  const occupied = new Set<number>();
  for (const slot of slots) {
    if (!Number.isInteger(slot.position) || slot.position < 1 || poses.has(slot.driverNumber) || occupied.has(slot.position)) continue;
    const behind = metersToScene(GRID_FIRST_CAR_BEHIND_LINE_METERS + (slot.position - 1) * GRID_POSITION_SPACING_METERS, transform);
    const distance = startDistance - behind * track.direction;
    const front = distance + metersToScene(GRID_MARKING_FRONT_METERS, transform) * track.direction;
    const rear = distance + metersToScene(GRID_MARKING_REAR_METERS, transform) * track.direction;
    if (!track.path.closed && (Math.min(front, rear) < 0 || Math.max(front, rear) > track.path.totalLength)) continue;
    poses.set(slot.driverNumber, track.poseAt(distance, offsets.get(slot.driverNumber) ?? 0));
    occupied.add(slot.position);
  }
  return poses;
}

export function createStartingGridMarkings(
  poses: Map<number, StartingGridPose>,
  track: StartingGridTrack,
  transform: SceneTransform,
): THREE.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const halfWidth = metersToScene(1.3, transform);
  const front = metersToScene(GRID_MARKING_FRONT_METERS, transform);
  const rear = metersToScene(GRID_MARKING_REAR_METERS, transform);
  const stroke = metersToScene(0.12, transform);
  const clearance = metersToScene(0.028, transform);

  for (const pose of poses.values()) {
    const addStripe = (left: number, right: number, back: number, ahead: number) => {
      const steps = Math.ceil((ahead - back) / 0.5);
      for (let step = 0; step <= steps; step++) {
        const row = positions.length / 3;
        const along = THREE.MathUtils.lerp(back, ahead, step / steps);
        const distance = pose.distance + along * track.direction;
        for (const lateral of [left, right]) {
          const point = track.pointAt(distance, pose.offset + lateral);
          positions.push(point.x, point.y + clearance, point.z);
        }
        if (step > 0) indices.push(row - 2, row - 1, row, row, row - 1, row + 1);
      }
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
