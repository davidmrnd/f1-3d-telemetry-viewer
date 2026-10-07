import type { TrackPoint3D } from "../../types";
import { type Polyline3, polylineFromCoordinates } from "./polyline";

export interface SampledSpline {
  line: Polyline3;
  nodeArcLengths: Float64Array;
}

function chordLengthParameters(nodes: TrackPoint3D[]): Float64Array {
  const parameters = new Float64Array(nodes.length);
  for (let index = 1; index < nodes.length; index += 1) {
    const previous = nodes[index - 1];
    const current = nodes[index];
    parameters[index] =
      parameters[index - 1] + Math.hypot(current.x - previous.x, current.y - previous.y, current.z - previous.z);
  }
  return parameters;
}

function naturalSecondDerivatives(parameters: Float64Array, values: Float64Array): Float64Array {
  const count = values.length;
  const secondDerivatives = new Float64Array(count);
  if (count < 3) {
    return secondDerivatives;
  }

  const lower = new Float64Array(count);
  const diagonal = new Float64Array(count);
  const upper = new Float64Array(count);
  const rhs = new Float64Array(count);
  diagonal[0] = 1;
  diagonal[count - 1] = 1;

  for (let index = 1; index < count - 1; index += 1) {
    const before = parameters[index] - parameters[index - 1];
    const after = parameters[index + 1] - parameters[index];
    lower[index] = before;
    diagonal[index] = 2 * (before + after);
    upper[index] = after;
    rhs[index] = 6 * ((values[index + 1] - values[index]) / after - (values[index] - values[index - 1]) / before);
  }

  for (let index = 1; index < count; index += 1) {
    const factor = lower[index] / diagonal[index - 1];
    diagonal[index] -= factor * upper[index - 1];
    rhs[index] -= factor * rhs[index - 1];
  }

  secondDerivatives[count - 1] = rhs[count - 1] / diagonal[count - 1];
  for (let index = count - 2; index >= 0; index -= 1) {
    secondDerivatives[index] = (rhs[index] - upper[index] * secondDerivatives[index + 1]) / diagonal[index];
  }

  return secondDerivatives;
}

function evaluateSegment(
  values: Float64Array,
  secondDerivatives: Float64Array,
  segment: number,
  span: number,
  u: number,
): number {
  const a = 1 - u;
  return (
    a * values[segment] +
    u * values[segment + 1] +
    (((a * a * a - a) * secondDerivatives[segment] + (u * u * u - u) * secondDerivatives[segment + 1]) * span * span) /
      6
  );
}

export function sampleNaturalCubicSpline(nodes: TrackPoint3D[], spacing: number): SampledSpline {
  const parameters = chordLengthParameters(nodes);
  const xs = Float64Array.from(nodes, (node) => node.x);
  const ys = Float64Array.from(nodes, (node) => node.y);
  const zs = Float64Array.from(nodes, (node) => node.z);
  const mx = naturalSecondDerivatives(parameters, xs);
  const my = naturalSecondDerivatives(parameters, ys);
  const mz = naturalSecondDerivatives(parameters, zs);

  const sampledX: number[] = [xs[0]];
  const sampledY: number[] = [ys[0]];
  const sampledZ: number[] = [zs[0]];
  const nodeSampleIndices = new Int32Array(nodes.length);

  for (let segment = 0; segment < nodes.length - 1; segment += 1) {
    const span = parameters[segment + 1] - parameters[segment];
    const steps = Math.max(2, Math.ceil(span / spacing));
    for (let step = 1; step <= steps; step += 1) {
      const u = step / steps;
      sampledX.push(evaluateSegment(xs, mx, segment, span, u));
      sampledY.push(evaluateSegment(ys, my, segment, span, u));
      sampledZ.push(evaluateSegment(zs, mz, segment, span, u));
    }
    nodeSampleIndices[segment + 1] = sampledX.length - 1;
  }

  const line = polylineFromCoordinates(
    Float64Array.from(sampledX),
    Float64Array.from(sampledY),
    Float64Array.from(sampledZ),
  );
  const nodeArcLengths = Float64Array.from(nodeSampleIndices, (sampleIndex) => line.arcLengths[sampleIndex]);
  return { line, nodeArcLengths };
}
