import * as THREE from "three";
import type { CarSample, ReplaySegment, TrackPoint3D } from "../types";

/** OpenF1 x/y/z en décimos de metro (coherente con el campo speed en km/h). */
export const OPENF1_UNITS_TO_METERS = 0.1;

/** 1 unidad Three.js = 1 metro (convención WebXR / escala real). */
export const SCENE_METERS_PER_UNIT = 1;

/** Longitud aproximada monoplaza F1 (m). Reglamento ~5,5 m; ajustable. */
export const F1_CAR_LENGTH_METERS = 5.5;

/** Ancho útil de asfalto (m). Catalunya ~12–15 m; valor por defecto conservador. */
export const TRACK_SURFACE_WIDTH_METERS = 12;

/** Ancho del kerb a cada borde (m). */
export const TRACK_KERB_WIDTH_METERS = 0.35;

export interface TrackRibbonOptions {
  tileSizeMeters?: number;
  closed?: boolean;
}

/** Separación entre vértices al densificar la polyline (m). Solo interpolación lineal. */
export const TRACK_PATH_DENSIFY_SPACING_METERS = 4;

/** Separación al remuestrear la centerline suavizada para el ribbon visual (m). */
export const TRACK_PATH_SMOOTH_SPACING_METERS = 2;

export interface SceneTransform {
  /** Metros de escena por unidad OpenF1 en plano horizontal. */
  scale: number;
  centerX: number;
  centerZ: number;
  /** Altitud OpenF1 mínima del segmento (suelo de referencia y = 0). */
  baseY: number;
  /** Metros de escena por unidad OpenF1 en eje vertical. */
  elevationScale: number;
}

/**
 * Misma lógica que `deriveLapTrack` en `scripts/cache-replay-segment.mjs`:
 * puntos reales del piloto, sin splines.
 */
export function deriveTrackCenterlineFromSamples(
  samples: CarSample[],
  simplifyStep = 3,
): TrackPoint3D[] {
  if (samples.length < 4) {
    return [];
  }

  return samples
    .filter((_, index) => index % simplifyStep === 0)
    .map((sample) => ({
      x: sample.x,
      y: sample.y,
      z: sample.z,
    }));
}

function trackLoopGapMeters(points: TrackPoint3D[]): number {
  if (points.length < 2) {
    return Number.POSITIVE_INFINITY;
  }

  const first = points[0];
  const last = points[points.length - 1];
  return Math.hypot(first.x - last.x, first.z - last.z) * OPENF1_UNITS_TO_METERS;
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

export function pickTrackDriverNumber(segment: ReplaySegment): number {
  const preferred = segment.drivers.find((driver) => segment.samples[driver.driverNumber]?.length);
  return preferred?.driverNumber ?? segment.drivers[0]?.driverNumber ?? 1;
}

/** Centerline fiel a telemetría: vuelta completa del JSON o, si aplica, trazada cerrada del piloto del segmento. */
export function buildTrackCenterline(segment: ReplaySegment, simplifyStep = 2): TrackPoint3D[] {
  const driverNumber = pickTrackDriverNumber(segment);
  const samples = segment.samples[driverNumber];
  if (samples && samples.length > 24) {
    const fromDriver = deriveTrackCenterlineFromSamples(samples, simplifyStep);
    if (isClosedTrackLoop(fromDriver)) {
      return closeTrackLoop(fromDriver);
    }
  }

  return closeTrackLoop(segment.circuit.centerline);
}

/** Añade vértices a lo largo de la polyline sin cambiar la trazada (sin splines). */
export function densifyPolylineLinear(
  points: THREE.Vector3[],
  spacingMeters = TRACK_PATH_DENSIFY_SPACING_METERS,
): THREE.Vector3[] {
  if (points.length < 2 || spacingMeters <= 0) {
    return points;
  }

  const path = [...points];
  const first = path[0];
  const last = path[path.length - 1];
  const closed = first.distanceToSquared(last) < 1e-4;
  if (closed) {
    path.pop();
  }

  if (path.length < 2) {
    return points;
  }

  const densified: THREE.Vector3[] = [];
  for (let i = 0; i < path.length; i += 1) {
    const current = path[i];
    const next = path[(i + 1) % path.length];
    densified.push(current.clone());

    const segment = next.clone().sub(current);
    const length = segment.length();
    if (length <= spacingMeters) {
      continue;
    }

    const steps = Math.floor(length / spacingMeters);
    segment.divideScalar(length);
    for (let step = 1; step < steps; step += 1) {
      densified.push(current.clone().add(segment.clone().multiplyScalar(step * spacingMeters)));
    }
  }

  if (closed) {
    densified.push(densified[0].clone());
  }

  return densified;
}

function polylineTangent(points: THREE.Vector3[], index: number, closed: boolean): THREE.Vector3 {
  const previous = closed
    ? points[(index - 1 + points.length) % points.length]
    : points[Math.max(index - 1, 0)];
  const next = closed
    ? points[(index + 1) % points.length]
    : points[Math.min(index + 1, points.length - 1)];
  const tangent = next.clone().sub(previous);
  tangent.y = 0;
  if (tangent.lengthSq() > 0) {
    tangent.normalize();
  }
  return tangent;
}

function polylineNormal(points: THREE.Vector3[], index: number, closed: boolean): THREE.Vector3 {
  const tangent = polylineTangent(points, index, closed);
  return new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
}

function buildPolylineDistances(points: THREE.Vector3[]): number[] {
  const distances = new Array<number>(points.length).fill(0);
  for (let i = 1; i < points.length; i += 1) {
    distances[i] = distances[i - 1] + points[i].distanceTo(points[i - 1]);
  }
  return distances;
}

export function isClosedCircuitPath(points: THREE.Vector3[], thresholdMeters = 1): boolean {
  if (points.length < 4) {
    return false;
  }
  return points[0].distanceTo(points[points.length - 1]) <= thresholdMeters;
}

export function normalizeCircuitPath(points: THREE.Vector3[]): { path: THREE.Vector3[]; closed: boolean } {
  if (points.length < 2) {
    return { path: points, closed: false };
  }

  const closed = isClosedCircuitPath(points);
  if (!closed) {
    return { path: points, closed: false };
  }

  const path = [...points];
  if (path[0].distanceTo(path[path.length - 1]) <= 1) {
    path.pop();
  }
  return { path, closed: true };
}

/**
 * Suaviza una polyline con Catmull-Rom y la remuestrea a paso fijo en metros.
 * Mantiene la trazada general de telemetría pero elimina el aspecto de "codos" en curvas.
 */
export function smoothPolylineCatmullRom(
  points: THREE.Vector3[],
  closed: boolean,
  spacingMeters = TRACK_PATH_SMOOTH_SPACING_METERS,
  tension = 0.35,
): THREE.Vector3[] {
  if (points.length < 4 || spacingMeters <= 0) {
    return densifyPolylineLinear(points, spacingMeters);
  }

  const curve = new THREE.CatmullRomCurve3(points, closed, "catmullrom", tension);
  const pathLength = curve.getLength();
  const sampleCount = Math.max(
    Math.ceil(pathLength / spacingMeters),
    closed ? points.length * 2 : points.length,
  );
  const sampled = curve.getSpacedPoints(sampleCount);

  if (!closed) {
    return sampled;
  }

  const smoothPath = [...sampled];
  if (
    smoothPath.length > 1 &&
    smoothPath[0].distanceTo(smoothPath[smoothPath.length - 1]) <= 0.05
  ) {
    smoothPath.pop();
  }
  return smoothPath;
}

/** Centerline visual lista para ribbon: normaliza bucle y suaviza curvas. */
export function buildVisualCircuitPath(
  points: THREE.Vector3[],
  spacingMeters = TRACK_PATH_SMOOTH_SPACING_METERS,
): { path: THREE.Vector3[]; closed: boolean } {
  const { path, closed } = normalizeCircuitPath(points);
  if (path.length < 2) {
    return { path, closed };
  }

  return {
    path: smoothPolylineCatmullRom(path, closed, spacingMeters),
    closed,
  };
}

/** Desplaza la polyline perpendicularmente (positivo = izquierda respecto al sentido). */
export function offsetPolyline(points: THREE.Vector3[], offsetMeters: number, closed: boolean): THREE.Vector3[] {
  return points.map((current, index) => {
    const normal = polylineNormal(points, index, closed);
    return current.clone().add(normal.multiplyScalar(offsetMeters));
  });
}

export function createTrackRibbon(
  points: THREE.Vector3[],
  width: number,
  options: TrackRibbonOptions = {},
) {
  const tileSizeMeters = options.tileSizeMeters ?? 2;
  const closed = options.closed ?? true;
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  if (points.length < 2) {
    return geometry;
  }

  const distances = buildPolylineDistances(points);
  const segmentCount = closed ? points.length : points.length - 1;
  const uAcross = width / tileSizeMeters;

  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const normal = polylineNormal(points, i, closed);
    const left = current.clone().add(normal.clone().multiplyScalar(width / 2));
    const right = current.clone().add(normal.clone().multiplyScalar(-width / 2));
    const v = distances[i] / tileSizeMeters;

    positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
    uvs.push(0, v, uAcross, v);

    if (i >= segmentCount) {
      continue;
    }

    const base = i * 2;
    const nextBase = closed ? ((i + 1) % points.length) * 2 : (i + 1) * 2;
    indices.push(base, nextBase, base + 1, nextBase, nextBase + 1, base + 1);
  }

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function vectorFromPoint(point: TrackPoint3D, transform: SceneTransform) {
  return new THREE.Vector3(
    (point.x - transform.centerX) * transform.scale,
    (point.y - transform.baseY) * transform.elevationScale,
    (transform.centerZ - point.z) * transform.scale,
  );
}

/** Convierte metros reales a unidades de escena (1:1 con SCENE_METERS_PER_UNIT). */
export function metersToScene(meters: number, transform: SceneTransform): number {
  return (meters / OPENF1_UNITS_TO_METERS) * transform.scale * SCENE_METERS_PER_UNIT;
}

export function carLengthInScene(transform: SceneTransform): number {
  return metersToScene(F1_CAR_LENGTH_METERS, transform);
}

export function trackWidthInScene(transform: SceneTransform): number {
  return metersToScene(TRACK_SURFACE_WIDTH_METERS, transform);
}

export interface GrassTerrainOptions {
  /** Mitad del lado del terreno en metros (por defecto 3000). */
  halfExtentMeters?: number;
  /** Separación objetivo entre vértices del grid (m). Tiene prioridad sobre `gridSegments`. */
  gridSpacingMeters?: number;
  /** Divisiones por eje del grid (solo si no se indica `gridSpacingMeters`). */
  gridSegments?: number;
  /** Tamaño de tile de césped para UVs en metros reales. */
  grassTileMeters?: number;
  /** Centerline del circuito (misma polyline que el ribbon de pista). */
  centerline: THREE.Vector3[];
  /** Si la centerline forma un bucle cerrado. */
  centerlineClosed?: boolean;
  /** Radio lateral (m) bajo asfalto/kerbs donde el césped se hunde (sin eliminar malla). */
  trackDepressionHalfWidthMeters?: number;
  /** Holgura vertical bajo la pista dentro de la zona de hundimiento (m). */
  depressionClearanceMeters?: number;
  /** Holgura en zonas alejadas del asfalto (m). */
  outerClearanceMeters?: number;
  /** Ancho de transición suave de holgura fuera de la zona de hundimiento (m). */
  clearanceFadeMeters?: number;
}

const GRASS_TERRAIN_DEFAULT_HALF_EXTENT = 3000;
const GRASS_TERRAIN_DEFAULT_GRID_SPACING = 24;
const GRASS_TERRAIN_MAX_GRID_SEGMENTS = 160;

interface PolylineProjection {
  y: number;
  lateralDistance: number;
}

/** Proyecta (x, z) sobre la polyline en plano XZ e interpola Y entre vértices. */
export function projectPointOntoPolylineXZ(
  x: number,
  z: number,
  points: THREE.Vector3[],
  closed: boolean,
): PolylineProjection | null {
  if (points.length < 2) {
    return points.length === 1 ? { y: points[0].y, lateralDistance: 0 } : null;
  }

  let bestDistSq = Number.POSITIVE_INFINITY;
  let bestY = points[0].y;

  const segmentCount = closed ? points.length : points.length - 1;
  for (let i = 0; i < segmentCount; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;

    let t = 0;
    if (lenSq > 1e-8) {
      t = ((x - a.x) * dx + (z - a.z) * dz) / lenSq;
      t = Math.max(0, Math.min(1, t));
    }

    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const distSq = (x - px) ** 2 + (z - pz) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestY = a.y + (b.y - a.y) * t;
    }
  }

  return { y: bestY, lateralDistance: Math.sqrt(bestDistSq) };
}

function resolveGrassGridSegments(halfExtent: number, options: GrassTerrainOptions): number {
  if (options.gridSegments !== undefined) {
    return options.gridSegments;
  }

  const spacing = options.gridSpacingMeters ?? GRASS_TERRAIN_DEFAULT_GRID_SPACING;
  const sideMeters = halfExtent * 2;
  return Math.min(GRASS_TERRAIN_MAX_GRID_SEGMENTS, Math.max(32, Math.ceil(sideMeters / spacing)));
}

function sampleGrassHeight(
  projection: PolylineProjection,
  trackDepressionHalfWidth: number,
  depressionClearance: number,
  outerClearance: number,
  clearanceFadeMeters: number,
): number {
  const { lateralDistance, y } = projection;

  if (lateralDistance <= trackDepressionHalfWidth) {
    return y - depressionClearance;
  }

  const fadeEnd = trackDepressionHalfWidth + clearanceFadeMeters;
  let clearance = outerClearance;
  if (clearanceFadeMeters > 0 && lateralDistance < fadeEnd) {
    const t = (fadeEnd - lateralDistance) / clearanceFadeMeters;
    clearance = outerClearance + t * (depressionClearance - outerClearance);
  }

  return y - clearance;
}

/**
 * Terreno de césped que sigue la elevación de la centerline (misma base que el ribbon de pista).
 * UVs en metros para tiling PBR con `grassTileMeters`.
 */
export function createGrassTerrainGeometry(options: GrassTerrainOptions): THREE.BufferGeometry {
  const halfExtent = options.halfExtentMeters ?? GRASS_TERRAIN_DEFAULT_HALF_EXTENT;
  const segments = resolveGrassGridSegments(halfExtent, options);
  const grassTileMeters = options.grassTileMeters ?? 4;
  const centerline = options.centerline;
  const closed = options.centerlineClosed ?? true;
  const trackDepressionHalfWidth = options.trackDepressionHalfWidthMeters ?? 10;
  const depressionClearance = options.depressionClearanceMeters ?? 0.5;
  const outerClearance = options.outerClearanceMeters ?? 0.05;
  const clearanceFadeMeters = options.clearanceFadeMeters ?? 20;
  const geometry = new THREE.BufferGeometry();
  const vertexCount = (segments + 1) * (segments + 1);
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices: number[] = [];

  const step = (halfExtent * 2) / segments;

  for (let iz = 0; iz <= segments; iz += 1) {
    for (let ix = 0; ix <= segments; ix += 1) {
      const x = -halfExtent + ix * step;
      const z = -halfExtent + iz * step;
      const projection = projectPointOntoPolylineXZ(x, z, centerline, closed);
      const vertexIndex = iz * (segments + 1) + ix;

      const y = projection
        ? sampleGrassHeight(
            projection,
            trackDepressionHalfWidth,
            depressionClearance,
            outerClearance,
            clearanceFadeMeters,
          )
        : 0;

      positions[vertexIndex * 3] = x;
      positions[vertexIndex * 3 + 1] = y;
      positions[vertexIndex * 3 + 2] = z;
      uvs[vertexIndex * 2] = x / grassTileMeters;
      uvs[vertexIndex * 2 + 1] = z / grassTileMeters;
    }
  }

  for (let iz = 0; iz < segments; iz += 1) {
    for (let ix = 0; ix < segments; ix += 1) {
      const rowStride = segments + 1;
      const a = iz * rowStride + ix;
      const b = a + 1;
      const c = a + rowStride;
      const d = c + 1;

      indices.push(a, c, b, b, c, d);
    }
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function buildTransform(segment: ReplaySegment): SceneTransform {
  const pointCloud: TrackPoint3D[] = [
    ...segment.circuit.centerline,
    ...Object.values(segment.samples).flat().map((sample) => ({
      x: sample.x,
      y: sample.y,
      z: sample.z,
    })),
  ];

  const minY = Math.min(...pointCloud.map((point) => point.y));
  const minX = Math.min(...pointCloud.map((point) => point.x));
  const maxX = Math.max(...pointCloud.map((point) => point.x));
  const minZ = Math.min(...pointCloud.map((point) => point.z));
  const maxZ = Math.max(...pointCloud.map((point) => point.z));

  return {
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    baseY: minY,
    scale: OPENF1_UNITS_TO_METERS * SCENE_METERS_PER_UNIT,
    elevationScale: OPENF1_UNITS_TO_METERS * SCENE_METERS_PER_UNIT,
  };
}
