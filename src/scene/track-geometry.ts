import * as THREE from "three";
import type { CarSample, CircuitCorner, ReplaySegment, TrackPoint3D } from "../types";
import { findPathIntersectionsXZ, normalizeCircuitPath } from "./track/path";

export const OPENF1_UNITS_TO_METERS = 0.1;
export const SCENE_METERS_PER_UNIT = 1;
export const F1_CAR_LENGTH_METERS = 5.5;
export const TRACK_SURFACE_WIDTH_METERS = 12;
export const TRACK_KERB_WIDTH_METERS = 0.35;

export { buildVisualCircuitPath } from "./track/path";
export { buildTrackCrossSections, createTrackRibbon } from "./track/ribbon";
export type { TrackCrossSection } from "./track/ribbon";

const TRACK_LAP_MIN_FLYING_SPEED_KMH = 80;
const TRACK_LAP_CORNER_COVERAGE_METERS = 40;
const TRACK_LAP_START_STRIDE = 12;

function isFiniteTrackPoint(point: TrackPoint3D): boolean {
  return [point.x, point.y, point.z].every(Number.isFinite);
}

export interface SceneTransform {
  scale: number;
  centerX: number;
  centerZ: number;
  baseY: number;
  elevationScale: number;
}

export function deriveTrackCenterlineFromSamples(
  samples: CarSample[],
  simplifyStep = 1,
): TrackPoint3D[] {
  if (samples.length < 4) {
    return [];
  }

  const step = Math.max(1, Math.floor(simplifyStep));
  return samples
    .filter((sample, index) => (index % step === 0 || index === samples.length - 1) &&
      [sample.x, sample.y, sample.z].every(Number.isFinite))
    .map((sample) => ({
      x: sample.x,
      y: sample.y,
      z: sample.z,
    }));
}

function horizontalDistanceMeters(
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  return Math.hypot(ax - bx, az - bz) * OPENF1_UNITS_TO_METERS;
}

function trackPointsLengthMeters(points: TrackPoint3D[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const curr = points[index];
    length += horizontalDistanceMeters(prev.x, prev.z, curr.x, curr.z);
  }
  return length;
}

function trackLoopGapMeters(points: TrackPoint3D[]): number {
  if (points.length < 2) {
    return Number.POSITIVE_INFINITY;
  }

  const first = points[0];
  const last = points[points.length - 1];
  return horizontalDistanceMeters(first.x, first.z, last.x, last.z);
}

function isClosedTrackLoop(points: TrackPoint3D[], thresholdMeters = 120): boolean {
  return points.length >= 4 && trackLoopGapMeters(points) <= thresholdMeters;
}

function closeTrackLoop(points: TrackPoint3D[]): TrackPoint3D[] {
  if (!isClosedTrackLoop(points) || points.length < 2) {
    return points;
  }

  const first = points[0];
  const last = points[points.length - 1];
  if (first.x === last.x && first.y === last.y && first.z === last.z) {
    return points;
  }

  return [...points, { ...first }];
}

function distanceToCircuitCornerMeters(point: TrackPoint3D, corner: CircuitCorner): number {
  return horizontalDistanceMeters(point.x, point.z, corner.x, corner.y);
}

export function pathCoversCircuitCorners(
  points: TrackPoint3D[],
  corners: CircuitCorner[],
  maxMeters = TRACK_LAP_CORNER_COVERAGE_METERS,
): boolean {
  if (corners.length === 0 || points.length === 0) {
    return corners.length === 0;
  }

  return corners.every((corner) => {
    let best = Number.POSITIVE_INFINITY;
    for (const point of points) {
      best = Math.min(best, distanceToCircuitCornerMeters(point, corner));
      if (best <= maxMeters) {
        return true;
      }
    }
    return false;
  });
}

function scoreClosedLapCandidate(
  gapMeters: number,
  traveledMeters: number,
  expectedLapMeters: number,
): number {
  return gapMeters + Math.abs(traveledMeters - expectedLapMeters) * 0.35;
}

function extractClosedLapFromStart(
  samples: CarSample[],
  startIndex: number,
  expectedLapMeters: number,
): CarSample[] | null {
  if (startIndex < 0 || startIndex >= samples.length - 3) {
    return null;
  }

  const start = samples[startIndex];
  if (start.speed < TRACK_LAP_MIN_FLYING_SPEED_KMH) {
    return null;
  }

  const closeThresholdMeters = 40;
  const minLapMeters = Math.max(3000, expectedLapMeters * 0.85);
  const maxLapMeters = expectedLapMeters > 0 ? expectedLapMeters * 1.2 : 8500;
  let traveled = 0;
  let bestEnd: number | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const direction = samples.slice(startIndex + 1).find((sample) =>
    horizontalDistanceMeters(start.x, start.z, sample.x, sample.z) > 2);
  if (!direction) return null;
  const startDx = direction.x - start.x;
  const startDz = direction.z - start.z;

  for (let index = startIndex + 1; index < samples.length; index += 1) {
    const prev = samples[index - 1];
    const curr = samples[index];
    traveled += horizontalDistanceMeters(prev.x, prev.z, curr.x, curr.z);

    if (traveled < minLapMeters) {
      continue;
    }
    if (traveled > maxLapMeters) {
      break;
    }

    const dx = curr.x - prev.x;
    const dz = curr.z - prev.z;
    if (dx * startDx + dz * startDz <= 0) continue;
    const lengthSq = dx * dx + dz * dz;
    if (lengthSq < 1e-8) continue;
    const t = Math.max(0, Math.min(1, ((start.x - prev.x) * dx + (start.z - prev.z) * dz) / lengthSq));
    const gap = horizontalDistanceMeters(prev.x + dx * t, prev.z + dz * t, start.x, start.z);
    if (gap > closeThresholdMeters) {
      continue;
    }

    const score = scoreClosedLapCandidate(gap, traveled - Math.sqrt(lengthSq) * (1 - t) * OPENF1_UNITS_TO_METERS, expectedLapMeters);
    if (score < bestScore) {
      bestScore = score;
      bestEnd = index;
    }
  }

  return bestEnd == null ? null : [...samples.slice(startIndex, bestEnd), { ...samples[bestEnd], x: start.x, y: start.y, z: start.z }];
}

function extractClosedLapSamples(
  samples: CarSample[],
  expectedLapMeters: number,
  corners: CircuitCorner[] = [],
): CarSample[] | null {
  if (samples.length < 4) {
    return null;
  }

  let bestLap: CarSample[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let startIndex = 0; startIndex < samples.length - 3; startIndex += TRACK_LAP_START_STRIDE) {
    const candidate = extractClosedLapFromStart(samples, startIndex, expectedLapMeters);
    if (!candidate || candidate.length < 24) {
      continue;
    }

    const points = candidate.map((sample) => ({ x: sample.x, y: sample.y, z: sample.z }));
    if (!pathCoversCircuitCorners(points, corners)) {
      continue;
    }

    const traveled = trackPointsLengthMeters(points);
    const gap = trackLoopGapMeters(points);
    const score = scoreClosedLapCandidate(gap, traveled, expectedLapMeters);
    if (score < bestScore) {
      const { path } = normalizeCircuitPath(points.map((point) => new THREE.Vector3(
        point.x * OPENF1_UNITS_TO_METERS,
        point.y * OPENF1_UNITS_TO_METERS,
        point.z * OPENF1_UNITS_TO_METERS,
      )));
      if (findPathIntersectionsXZ(path, true).length) continue;
      bestScore = score;
      bestLap = candidate;
    }
  }

  return bestLap;
}

export function pickTrackDriverNumber(segment: ReplaySegment): number {
  const preferred = segment.drivers.find((driver) => segment.samples[driver.driverNumber]?.length);
  return preferred?.driverNumber ?? segment.drivers[0]?.driverNumber ?? 1;
}

function trackDriverCandidates(segment: ReplaySegment): number[] {
  const preferred = pickTrackDriverNumber(segment);
  const rest = segment.drivers
    .map((driver) => driver.driverNumber)
    .filter((driverNumber) => driverNumber !== preferred);
  return [preferred, ...rest];
}

export function buildTrackCenterline(segment: ReplaySegment, simplifyStep = 1): TrackPoint3D[] {
  const stored = closeTrackLoop(segment.circuit.centerline.filter(isFiniteTrackPoint));
  const expectedLapMeters = Math.max(trackPointsLengthMeters(stored), 3000);
  const corners = segment.circuit.corners;

  for (const driverNumber of trackDriverCandidates(segment)) {
    const samples = segment.samples[driverNumber]?.filter(isFiniteTrackPoint);
    if (!samples || samples.length <= 24) {
      continue;
    }

    const lapSamples = extractClosedLapSamples(samples, expectedLapMeters, corners);
    if (!lapSamples || lapSamples.length <= 24) {
      continue;
    }

    const fromDriver = deriveTrackCenterlineFromSamples(lapSamples, simplifyStep);
    if (fromDriver.length >= 4 && pathCoversCircuitCorners(fromDriver, corners)) {
      return closeTrackLoop(fromDriver);
    }
  }

  return stored;
}

export function vectorFromPoint(point: TrackPoint3D, transform: SceneTransform) {
  return new THREE.Vector3(
    (point.x - transform.centerX) * transform.scale,
    (point.y - transform.baseY) * transform.elevationScale,
    (transform.centerZ - point.z) * transform.scale,
  );
}

export function metersToScene(meters: number, transform: SceneTransform): number {
  return (meters / OPENF1_UNITS_TO_METERS) * transform.scale * SCENE_METERS_PER_UNIT;
}

export function carLengthInScene(transform: SceneTransform): number {
  return metersToScene(F1_CAR_LENGTH_METERS, transform);
}

export function trackWidthInScene(transform: SceneTransform): number {
  return metersToScene(TRACK_SURFACE_WIDTH_METERS, transform);
}

export function buildTransform(segment: ReplaySegment): SceneTransform {
  let minY = Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const points of [segment.circuit.centerline, ...Object.values(segment.samples)]) {
    for (const point of points) {
      if (!isFiniteTrackPoint(point)) continue;
      minY = Math.min(minY, point.y);
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    }
  }
  if (!Number.isFinite(minY)) {
    minY = minX = maxX = minZ = maxZ = 0;
  }

  return {
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    baseY: minY,
    scale: OPENF1_UNITS_TO_METERS * SCENE_METERS_PER_UNIT,
    elevationScale: OPENF1_UNITS_TO_METERS * SCENE_METERS_PER_UNIT,
  };
}
