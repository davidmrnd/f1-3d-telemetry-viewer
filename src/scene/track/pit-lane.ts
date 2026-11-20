import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { ReplaySegment } from "../../types";
import { TrackPath } from "../cameras/automatic/track-path";
import { TRACK_TILE_METERS } from "../track-environment";
import { vectorFromPoint, type SceneTransform } from "../track-geometry";
import { cleanCircuitPoints, smoothPolylineCatmullRom } from "./path";
import { buildTrackCrossSections, createTrackRibbon, crossSectionPoint, type TrackCrossSection } from "./ribbon";
import { createTerrainHeightSampler } from "./terrain-height";

const ASPHALT_CLEARANCE = 0.06;
const TRACE_MATCH_RADIUS = 6;
const TRACE_EXTENSION_MS = 10000;
const JOIN_BLEND_METERS = 46;
const JOIN_TAPER_METERS = 15;

export interface PitLane {
  path: TrackPath;
  mesh: THREE.Mesh;
  width: number;
  sections: TrackCrossSection[];
  heightAt: ReturnType<typeof createTerrainHeightSampler>;
}

export function createCircuitHeightSampler(road: THREE.BufferGeometry, groundHeight: ReturnType<typeof createTerrainHeightSampler>) {
  const roadHeight = createTerrainHeightSampler(road);
  return (x: number, z: number, fallback: number) => {
    const onRoad = roadHeight(x, z, NaN);
    return Number.isFinite(onRoad) ? onRoad : groundHeight(x, z, fallback);
  };
}

export function findPitOpenings(lane: PitLane, sections: TrackCrossSection[], closed: boolean, trackWidth: number) {
  const openings = new Set<number>();
  const count = closed ? sections.length : sections.length - 1;
  for (const side of [-1, 1]) {
    const edge = sections.map((section) => crossSectionPoint(section, side * trackWidth / 2));
    for (let i = 0; i < count; i++) {
      const midpoint = edge[i].clone().lerp(edge[(i + 1) % edge.length], 0.5);
      if (Number.isFinite(lane.heightAt(midpoint.x, midpoint.z, NaN))) openings.add(side * (i + 1));
    }
  }
  return (side: number, index: number) => openings.has(side * (index + 1));
}

function distanceToPath(point: THREE.Vector3, path: TrackPath) {
  const projection = path.projectPointPlanar(point);
  return projection ? Math.hypot(point.x - projection.point.x, point.z - projection.point.z) : Infinity;
}

function traceExtension(
  trace: THREE.Vector3[], step: -1 | 1, segment: ReplaySegment,
  transform: SceneTransform, main: TrackPath, roadEdge: number,
) {
  const endpoint = step === 1 ? trace.at(-1)! : trace[0];
  const next = step === 1 ? trace.at(-2)! : trace[1];
  if (distanceToPath(endpoint, main) <= roadEdge) return [];
  const direction = endpoint.clone().sub(next).normalize();
  let bestCost = Infinity;
  let best: THREE.Vector3[] = [];
  for (const samples of Object.values(segment.samples)) {
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      const start = vectorFromPoint(sample, transform).setY(0);
      const distance = start.distanceTo(endpoint);
      if (distance > TRACE_MATCH_RADIUS || distance >= bestCost) continue;
      const extension: THREE.Vector3[] = [];
      let previous = endpoint;
      let cost = distance;
      for (let j = i + step; samples[j] && Math.abs(samples[j].t - sample.t) <= TRACE_EXTENSION_MS; j += step) {
        const point = vectorFromPoint(samples[j], transform).setY(0);
        const travel = point.clone().sub(previous);
        const length = travel.length();
        if (length < 2) continue;
        if (length > 65) break;
        if (!extension.length) {
          const alignment = travel.dot(direction) / length;
          if (alignment < 0.55) break;
          cost += 8 * (1 - alignment);
        }
        extension.push(point);
        previous = point;
        if (distanceToPath(point, main) <= roadEdge && cost < bestCost) {
          best = extension;
          bestCost = cost;
          break;
        }
      }
    }
  }
  if (best.length) return best;

  const projection = main.projectPointPlanar(endpoint);
  const separation = distanceToPath(endpoint, main);
  if (!projection || separation > 35) return [];
  const sign = main.tangentAt(projection).dot(direction) < 0 ? -1 : 1;
  const mergeLength = THREE.MathUtils.clamp(separation * 2, 20, 65);
  return [endpoint.clone().addScaledVector(direction, mergeLength / 3),
    main.pointAt(projection.distance + sign * mergeLength).setY(0)];
}

function separateTrace(trace: THREE.Vector3[], main: TrackPath, roadEdge: number) {
  let first = 0;
  let last = 0;
  let longest = 0;
  let start = -1;
  let length = 0;
  trace.forEach((point, i) => {
    if (distanceToPath(point, main) <= roadEdge) {
      start = -1;
      length = 0;
      return;
    }
    if (start < 0) start = i;
    else length += point.distanceTo(trace[i - 1]);
    if (length > longest) {
      first = Math.max(0, start - 1);
      last = Math.min(trace.length - 1, i + 1);
      longest = length;
    }
  });
  return longest >= 60 ? trace.slice(first, last + 1) : [];
}

function smoothJunction(points: THREE.Vector3[], main: TrackPath, trackWidth: number, atExit: boolean) {
  const ordered = atExit ? [...points].reverse() : points;
  const branch = new TrackPath(ordered);
  const terminal = main.projectPointPlanar(ordered[0]);
  if (!terminal || distanceToPath(ordered[0], main) > trackWidth / 2 || branch.totalLength < 2 * JOIN_BLEND_METERS) return points;

  const anchorDistance = JOIN_BLEND_METERS;
  const anchor = branch.pointAt(anchorDistance);
  const branchDirection = branch.pointAt(anchorDistance + 3).sub(branch.pointAt(anchorDistance - 3)).normalize();
  const direction = atExit ? -1 : 1;
  const distance = terminal.distance - direction * 32;
  const center = main.pointAt(distance).setY(0);
  const tangent = main.pointAt(distance + direction * 2).sub(main.pointAt(distance - direction * 2)).setY(0).normalize();
  const lateral = new THREE.Vector3(-tangent.z, 0, tangent.x);
  const side = Math.sign(anchor.clone().sub(center).dot(lateral));
  const start = center.addScaledVector(lateral, side * trackWidth * 0.22);
  const controlLength = start.distanceTo(anchor) / 3;
  const curve = new THREE.CubicBezierCurve3(
    start,
    start.clone().addScaledVector(tangent, controlLength),
    anchor.clone().addScaledVector(branchDirection, -controlLength),
    anchor,
  );
  const join = curve.getSpacedPoints(Math.max(8, Math.ceil(curve.getLength() / 1.5)));
  const { index, fraction } = branch.segmentAt(anchorDistance);
  const combined = [...join, ...ordered.slice(index + (fraction >= 1 ? 2 : 1))];
  return atExit ? combined.reverse() : combined;
}

function roundPitPath(points: THREE.Vector3[]) {
  const path = new TrackPath(points);
  let distance = 0;
  return points.map((point, index) => {
    if (index) distance += point.distanceTo(points[index - 1]);
    const radius = Math.min(11, distance, path.totalLength - distance);
    if (radius < 0.001) return point;
    return path.pointAt(distance - radius).addScaledVector(path.pointAt(distance - radius / 2), 2)
      .addScaledVector(point, 3).addScaledVector(path.pointAt(distance + radius / 2), 2)
      .add(path.pointAt(distance + radius)).multiplyScalar(1 / 9);
  });
}

function separateParallelLanes(points: THREE.Vector3[], main: TrackPath, trackWidth: number, pitWidth: number) {
  const distances = [0];
  for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + points[i].distanceTo(points[i - 1]));
  const length = distances.at(-1)!;
  const clearance = trackWidth / 2 + pitWidth / 2 + 1.2;
  return points.map((point, i) => {
    const fromEnd = Math.min(distances[i], length - distances[i]);
    if (fromEnd <= 28) return point;
    const projection = main.projectPointPlanar(point)!;
    const away = point.clone().sub(projection.point).setY(0);
    const separation = away.length();
    if (separation <= trackWidth / 2 || separation >= clearance) return point;
    const tangent = points[Math.min(i + 1, points.length - 1)].clone().sub(points[Math.max(0, i - 1)]).normalize();
    const alignment = Math.abs(tangent.dot(main.tangentAt(projection)));
    const weight = THREE.MathUtils.smoothstep(fromEnd, 28, 70)
      * THREE.MathUtils.smoothstep(alignment, 0.8, 0.98)
      * THREE.MathUtils.smoothstep(separation, trackWidth / 2, trackWidth / 2 + 2);
    return point.clone().addScaledVector(away, (clearance - separation) * weight / separation);
  });
}

export function createPitLane(
  segment: ReplaySegment, transform: SceneTransform, main: TrackPath,
  trackWidth: number, circuitHeight: ReturnType<typeof createCircuitHeightSampler>,
  asphalt: THREE.Material,
): PitLane | null {
  const data = segment.circuit.pitLane;
  if (!data || main.totalLength <= 0) return null;
  const trace = cleanCircuitPoints(data.centerline.map((point) => vectorFromPoint(point, transform).setY(0)));
  if (trace.length < 6) return null;
  const roadEdge = trackWidth / 2 - 1;
  const entry = traceExtension(trace, -1, segment, transform, main, roadEdge);
  const exit = traceExtension(trace, 1, segment, transform, main, roadEdge);
  const branch = separateTrace([...entry.reverse(), ...trace, ...exit], main, roadEdge);
  if (branch.length < 2) return null;
  const original = smoothPolylineCatmullRom(branch, false, 2);
  const entryJoined = smoothJunction(original, main, trackWidth, false);
  const width = Number.isFinite(data.width) ? THREE.MathUtils.clamp(data.width, 5, 10) : 9;
  const joined = smoothJunction(entryJoined, main, trackWidth, true);
  const points = roundPitPath(separateParallelLanes(joined, main, trackWidth, width));
  const crossSections = buildTrackCrossSections(points, false, width / 2);
  const distances = [0];
  for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + points[i].distanceTo(points[i - 1]));
  const length = distances.at(-1)!;
  crossSections.forEach((section, i) => {
    const fromEnd = Math.min(distances[i], length - distances[i]);
    section.widthScale *= THREE.MathUtils.lerp(0.02, 1, THREE.MathUtils.smoothstep(fromEnd, 0, JOIN_TAPER_METERS));
  });
  const tileSizeMeters = TRACK_TILE_METERS.road;
  const stripWidth = width / 6;
  const strips = Array.from({ length: 6 }, (_, index) => {
    const offsetMeters = width / 2 - (index + 0.5) * stripWidth;
    const strip = createTrackRibbon(points, stripWidth, { closed: false, crossSections, offsetMeters, tileSizeMeters });
    const positions = strip.getAttribute("position");
    const uv = strip.getAttribute("uv");
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const fallback = main.projectPointPlanar(new THREE.Vector3(x, 0, z))?.point.y ?? 0;
      positions.setY(i, circuitHeight(x, z, fallback) + ASPHALT_CLEARANCE);
      uv.setX(i, uv.getX(i) + index * stripWidth / tileSizeMeters);
    }
    return strip;
  });
  const geometry = mergeGeometries(strips);
  strips.forEach((strip) => strip.dispose());
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, asphalt);
  mesh.name = "pit-lane";
  mesh.receiveShadow = true;
  mesh.renderOrder = 3;
  return { path: new TrackPath(points), mesh, width, sections: crossSections, heightAt: createTerrainHeightSampler(geometry) };
}
