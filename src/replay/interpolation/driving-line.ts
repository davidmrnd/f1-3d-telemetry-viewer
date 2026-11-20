import type { TrackPoint3D } from "../../types";
import { gaussianSmooth } from "./gaussian-smoothing";
import type { LocationFix } from "./location-fixes";
import { sampleNaturalCubicSpline } from "./natural-cubic-spline";
import {
  type Polyline3,
  polylineFromCoordinates,
  polylineLength,
  projectOntoPolyline,
  resampleUniformly,
} from "./polyline";
import { intervalIndexAt } from "./sorted-search";

const NODE_MIN_SPACING_METERS = 2;
const REVERSAL_GUARD_METERS = 3;
const SPLINE_SAMPLE_SPACING_METERS = 0.25;
const LINE_STEP_METERS = 1;
const HORIZONTAL_SMOOTHING_SIGMA_METERS = 3;
const ELEVATION_SMOOTHING_SIGMA_METERS = 8;
const FIX_PROJECTION_RADIUS_METERS = NODE_MIN_SPACING_METERS + REVERSAL_GUARD_METERS;
const SEGMENTS_PER_LOOKUP_BUCKET = 8;

interface NodeSelection {
  nodes: TrackPoint3D[];
  nodeOfFix: Int32Array;
  anchorNodeOfFix: Int32Array;
}

export interface DrivingLineFit {
  line: DrivingLine;
  fixArcLengths: Float64Array;
}

function acceptsAsNode(nodes: TrackPoint3D[], fix: LocationFix): boolean {
  const last = nodes[nodes.length - 1];
  const distance = Math.hypot(fix.x - last.x, fix.y - last.y, fix.z - last.z);
  if (distance < NODE_MIN_SPACING_METERS) {
    return false;
  }
  if (nodes.length < 2 || distance >= REVERSAL_GUARD_METERS) {
    return true;
  }

  const previous = nodes[nodes.length - 2];
  const alongTrack = (last.x - previous.x) * (fix.x - last.x) + (last.z - previous.z) * (fix.z - last.z);
  return alongTrack >= 0;
}

function selectNodes(fixes: LocationFix[]): NodeSelection {
  const nodes: TrackPoint3D[] = [];
  const nodeOfFix = new Int32Array(fixes.length).fill(-1);
  const anchorNodeOfFix = new Int32Array(fixes.length);

  fixes.forEach((fix, index) => {
    if (nodes.length === 0 || acceptsAsNode(nodes, fix)) {
      nodes.push({ x: fix.x, y: fix.y, z: fix.z });
      nodeOfFix[index] = nodes.length - 1;
    }
    anchorNodeOfFix[index] = nodes.length - 1;
  });

  return { nodes, nodeOfFix, anchorNodeOfFix };
}

function remapUniformArcLength(arcLengths: Float64Array, fractionalIndex: number): number {
  const last = arcLengths.length - 1;
  const clamped = Math.min(last, Math.max(0, fractionalIndex));
  const index = Math.min(last - 1, Math.floor(clamped));
  return arcLengths[index] + (arcLengths[index + 1] - arcLengths[index]) * (clamped - index);
}

function valueBefore(values: Float64Array, index: number): number {
  return index > 0 ? values[index - 1] : 2 * values[index] - values[index + 1];
}

function valueAfter(values: Float64Array, index: number): number {
  return index + 2 < values.length ? values[index + 2] : 2 * values[index + 1] - values[index];
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  const tangentStart = (p2 - p0) / 2;
  const tangentEnd = (p3 - p1) / 2;
  return (
    (2 * u3 - 3 * u2 + 1) * p1 +
    (u3 - 2 * u2 + u) * tangentStart +
    (-2 * u3 + 3 * u2) * p2 +
    (u3 - u2) * tangentEnd
  );
}

export class DrivingLine {
  readonly length: number;
  private readonly intervalStarts: Uint32Array;
  private readonly bucketSize: number;

  private constructor(private readonly polyline: Polyline3) {
    this.length = polylineLength(polyline);
    const { arcLengths } = polyline;
    const lastInterval = arcLengths.length - 2;
    this.intervalStarts = new Uint32Array(Math.max(1, Math.ceil((arcLengths.length - 1) / SEGMENTS_PER_LOOKUP_BUCKET)));
    this.bucketSize = this.length / this.intervalStarts.length;
    let interval = 0;
    for (let bucket = 1; bucket < this.intervalStarts.length; bucket += 1) {
      const distance = bucket * this.bucketSize;
      while (interval < lastInterval && arcLengths[interval + 1] <= distance) {
        interval += 1;
      }
      this.intervalStarts[bucket] = interval;
    }
  }

  static fromFixes(fixes: LocationFix[]): DrivingLineFit {
    const selection = selectNodes(fixes);
    if (selection.nodes.length < 2) {
      const only = selection.nodes[0] ?? { x: 0, y: 0, z: 0 };
      return {
        line: new DrivingLine(polylineFromCoordinates(Float64Array.of(only.x), Float64Array.of(only.y), Float64Array.of(only.z))),
        fixArcLengths: new Float64Array(fixes.length),
      };
    }

    const spline = sampleNaturalCubicSpline(selection.nodes, SPLINE_SAMPLE_SPACING_METERS);
    const rawArcLengths = Float64Array.from(fixes, (fix, index) => {
      const node = selection.nodeOfFix[index];
      if (node >= 0) {
        return spline.nodeArcLengths[node];
      }
      const anchor = spline.nodeArcLengths[selection.anchorNodeOfFix[index]];
      return projectOntoPolyline(spline.line, fix, anchor, FIX_PROJECTION_RADIUS_METERS);
    });

    const uniform = resampleUniformly(spline.line, LINE_STEP_METERS);
    const smoothed = polylineFromCoordinates(
      gaussianSmooth(uniform.xs, HORIZONTAL_SMOOTHING_SIGMA_METERS / uniform.step),
      gaussianSmooth(uniform.ys, ELEVATION_SMOOTHING_SIGMA_METERS / uniform.step),
      gaussianSmooth(uniform.zs, HORIZONTAL_SMOOTHING_SIGMA_METERS / uniform.step),
    );
    const fixArcLengths = Float64Array.from(rawArcLengths, (arcLength) =>
      remapUniformArcLength(smoothed.arcLengths, arcLength / uniform.step),
    );

    return { line: new DrivingLine(smoothed), fixArcLengths };
  }

  pointAt(distance: number): TrackPoint3D {
    const { arcLengths, xs, ys, zs } = this.polyline;
    const count = arcLengths.length;
    if (count < 2) {
      return { x: xs[0], y: ys[0], z: zs[0] };
    }
    if (distance <= 0) {
      return this.extendAlong(0, 1, 0, distance);
    }
    if (distance >= this.length) {
      return this.extendAlong(count - 2, count - 1, count - 1, distance - this.length);
    }

    const index = this.findInterval(distance);
    const span = arcLengths[index + 1] - arcLengths[index];
    const u = span > 0 ? (distance - arcLengths[index]) / span : 0;
    return {
      x: catmullRom(valueBefore(xs, index), xs[index], xs[index + 1], valueAfter(xs, index), u),
      y: catmullRom(valueBefore(ys, index), ys[index], ys[index + 1], valueAfter(ys, index), u),
      z: catmullRom(valueBefore(zs, index), zs[index], zs[index + 1], valueAfter(zs, index), u),
    };
  }

  private findInterval(distance: number): number {
    const { arcLengths } = this.polyline;
    const bucket = Math.floor(distance / this.bucketSize);
    let index = this.intervalStarts[bucket];
    if (index === undefined || arcLengths[index] > distance) {
      return intervalIndexAt(arcLengths, distance);
    }
    const lastInterval = arcLengths.length - 2;
    while (index < lastInterval && arcLengths[index + 1] <= distance) {
      index += 1;
    }
    return index;
  }

  private extendAlong(fromIndex: number, toIndex: number, anchorIndex: number, offset: number): TrackPoint3D {
    const { arcLengths, xs, ys, zs } = this.polyline;
    const span = arcLengths[toIndex] - arcLengths[fromIndex];
    const scale = span > 0 ? offset / span : 0;
    return {
      x: xs[anchorIndex] + (xs[toIndex] - xs[fromIndex]) * scale,
      y: ys[anchorIndex] + (ys[toIndex] - ys[fromIndex]) * scale,
      z: zs[anchorIndex] + (zs[toIndex] - zs[fromIndex]) * scale,
    };
  }
}
