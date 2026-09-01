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

const CAMERA_LATERAL_OFFSET_METERS = 10;
const CAMERA_HEIGHT_METERS = 4.5;
const LOOK_AHEAD_METERS = 18;
const COVERAGE_RADIUS_METERS = 45;

export interface CornerCameraRig {
  path: TrackPath;
  cameras: CornerCameraDefinition[];
}

export function buildCornerCameraRig(segment: ReplaySegment, transform: SceneTransform): CornerCameraRig {
  const { path: pathPoints } = buildVisualCircuitPath(
    buildTrackCenterline(segment).map((point) => vectorFromPoint(point, transform)),
  );

  const path = new TrackPath(pathPoints);
  if (path.points.length < 4 || segment.circuit.corners.length === 0) {
    return { path, cameras: [] };
  }

  const centroid = path.centroid;
  const cameras = segment.circuit.corners
    .slice()
    .sort((a, b) => a.number - b.number)
    .map((corner) => buildCornerCamera(corner, transform, path, centroid));

  return { path, cameras };
}

function buildCornerCamera(
  corner: { number: number; x: number; y: number },
  transform: SceneTransform,
  path: TrackPath,
  trackCentroid: THREE.Vector3,
): CornerCameraDefinition {
  const cornerGuess = vectorFromPoint(
    { x: corner.x, y: transform.baseY, z: corner.y },
    transform,
  );
  const projection = path.projectPointPlanar(cornerGuess);
  const onTrack = projection?.point ?? cornerGuess;
  const trackDistance = projection?.distance ?? 0;
  const tangent = projection ? path.tangentAt(projection) : new THREE.Vector3(0, 0, 1);
  const outward = outwardNormal(tangent, onTrack, trackCentroid);

  const position = onTrack
    .clone()
    .add(outward.multiplyScalar(CAMERA_LATERAL_OFFSET_METERS))
    .add(new THREE.Vector3(0, CAMERA_HEIGHT_METERS, 0));

  const lookAt = onTrack.clone().add(tangent.clone().multiplyScalar(LOOK_AHEAD_METERS));
  lookAt.y = Math.max(lookAt.y, onTrack.y + 0.5);

  return {
    id: corner.number,
    label: `Curva ${corner.number}`,
    position,
    lookAt,
    trackDistance,
    coverageRadius: COVERAGE_RADIUS_METERS,
  };
}

function outwardNormal(
  tangent: THREE.Vector3,
  pointOnTrack: THREE.Vector3,
  trackCentroid: THREE.Vector3,
): THREE.Vector3 {
  const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
  const toCentroid = trackCentroid.clone().sub(pointOnTrack);
  toCentroid.y = 0;
  if (side.dot(toCentroid) > 0) {
    side.multiplyScalar(-1);
  }
  return side.normalize();
}
