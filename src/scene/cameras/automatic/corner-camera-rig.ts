import * as THREE from "three";
import type { ReplaySegment } from "../../../types";
import {
  buildTrackCenterline,
  buildVisualCircuitPath,
  vectorFromPoint,
  type SceneTransform,
} from "../../track-geometry";
import { TrackPath } from "./track-path";
import type { CornerCameraDefinition } from "./types";

const MAX_CAMERA_GAP_METERS = 180;

export interface CornerCameraRig {
  path: TrackPath;
  cameras: CornerCameraDefinition[];
}

export function buildCornerCameraRig(segment: ReplaySegment, transform: SceneTransform): CornerCameraRig {
  const { path: pathPoints, closed } = buildVisualCircuitPath(
    buildTrackCenterline(segment).map((point) => vectorFromPoint(point, transform)),
  );
  const path = new TrackPath(pathPoints, closed);
  if (path.points.length < 2 || path.totalLength <= 0) return { path, cameras: [] };

  const cameras = segment.circuit.corners.map((corner) => {
    const guess = vectorFromPoint({ x: corner.x, y: transform.baseY, z: corner.y }, transform);
    const distance = path.projectPointPlanar(guess)?.distance ?? 0;
    return buildCamera(corner.number, `Curva ${corner.number}`, distance, path, false);
  }).sort((a, b) => a.trackDistance - b.trackDistance);
  if (cameras.length === 0) {
    cameras.push(buildCamera(1, "Recta · seguimiento", 0, path, true));
  }

  const anchors = cameras.map((camera) => camera.trackDistance);
  if (!closed || anchors.length === 0) anchors.unshift(0);
  anchors.push(closed ? anchors[0] + path.totalLength : path.totalLength);
  let nextId = Math.max(0, ...cameras.map((camera) => camera.id)) + 1;
  for (let index = 1; index < anchors.length; index++) {
    const start = anchors[index - 1];
    const gap = anchors[index] - start;
    const count = Math.ceil(gap / MAX_CAMERA_GAP_METERS);
    for (let step = 1; step < count; step++) {
      cameras.push(buildCamera(nextId++, "Recta · seguimiento", start + gap * step / count, path, true));
    }
  }
  if (!closed) {
    if (!cameras.some((camera) => camera.trackDistance < 1)) {
      cameras.push(buildCamera(nextId++, "Recta · entrada", 0, path, true));
    }
    if (!cameras.some((camera) => camera.trackDistance > path.totalLength - 1)) {
      cameras.push(buildCamera(nextId, "Recta · salida", path.totalLength, path, true));
    }
  }
  return { path, cameras: cameras.sort((a, b) => a.trackDistance - b.trackDistance) };
}

function buildCamera(
  id: number,
  label: string,
  distance: number,
  path: TrackPath,
  straight: boolean,
): CornerCameraDefinition {
  const onTrack = path.pointAt(distance);
  const before = onTrack.clone().sub(path.pointAt(distance - 24)).setY(0).normalize();
  const after = path.pointAt(distance + 24).sub(onTrack).setY(0).normalize();
  const tangent = path.pointAt(distance + 5).sub(path.pointAt(distance - 5)).setY(0).normalize();
  const outward = new THREE.Vector3(-tangent.z, 0, tangent.x);
  const bend = before.x * after.z - before.z * after.x;
  if (Math.abs(bend) > 0.08) {
    if (bend > 0) outward.negate();
  } else if (outward.dot(path.centroid.sub(onTrack)) > 0) {
    outward.negate();
  }
  let position = onTrack.clone().addScaledVector(outward, straight ? 22 : 26);
  for (const offset of [26, 34, -26, -34, 42, -42]) {
    const nearest = path.projectPointPlanar(position);
    if (nearest && Math.hypot(position.x - nearest.point.x, position.z - nearest.point.z) >= 20) break;
    position = onTrack.clone().addScaledVector(outward, offset);
  }
  position.y += straight ? 5 : id % 3 === 0 ? 9 : 6;
  return {
    id,
    label,
    position,
    trackDistance: path.closed ? THREE.MathUtils.euclideanModulo(distance, path.totalLength) : distance,
    coverageRadius: 650,
    corner: !straight,
  };
}
