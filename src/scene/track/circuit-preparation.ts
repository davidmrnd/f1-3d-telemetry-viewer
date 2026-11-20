import { Vector3 } from "three";
import type { ReplaySegment } from "../../types";
import {
  buildTrackCenterline, buildTrackCrossSections, buildVisualCircuitPath,
  vectorFromPoint, type SceneTransform,
} from "../track-geometry";
import type { TrackCrossSection } from "./ribbon";
import type { TerrainSnapshot } from "./track-surfaces";

export interface CircuitSnapshot {
  points: [number, number, number][];
  closed: boolean;
  sections: [number, number, number, number][];
  terrain?: TerrainSnapshot;
}

export function isCircuitSnapshot(snapshot: CircuitSnapshot | undefined): snapshot is CircuitSnapshot {
  if (!snapshot || !Array.isArray(snapshot.points) || !Array.isArray(snapshot.sections) ||
    snapshot.points.length !== snapshot.sections.length || typeof snapshot.closed !== "boolean") return false;
  if (snapshot.points.length < 2) return true;
  const terrain = snapshot.terrain;
  if (!terrain || !(terrain.positions instanceof Float32Array) || !(terrain.normals instanceof Float32Array) ||
    !(terrain.uvs instanceof Float32Array) || !(terrain.colors instanceof Float32Array) ||
    !(terrain.index instanceof Uint16Array || terrain.index instanceof Uint32Array)) return false;
  const count = terrain.positions.length / 3;
  return Number.isInteger(count) && terrain.normals.length === count * 3 &&
    terrain.colors.length === count * 3 && terrain.uvs.length === count * 2 && terrain.index.length % 3 === 0;
}

export function prepareCircuit(segment: ReplaySegment, transform: SceneTransform, edge: number, snapshot?: CircuitSnapshot) {
  if (snapshot) {
    const points = snapshot.points.map(point => new Vector3(...point));
    return {
      points,
      closed: snapshot.closed,
      sections: snapshot.sections.map(([x, y, z, widthScale], index) => ({
        center: points[index], lateral: new Vector3(x, y, z), widthScale,
      })),
    };
  }
  const { path: points, closed } = buildVisualCircuitPath(
    buildTrackCenterline(segment).map(point => vectorFromPoint(point, transform)),
  );
  return { points, closed, sections: buildTrackCrossSections(points, closed, edge) };
}

export function snapshotCircuit(points: Vector3[], closed: boolean, sections: TrackCrossSection[], terrain?: TerrainSnapshot): CircuitSnapshot {
  return {
    points: points.map(point => point.toArray()),
    closed,
    sections: sections.map(({ lateral, widthScale }) => [lateral.x, lateral.y, lateral.z, widthScale]),
    terrain,
  };
}
