import type { ProgressKnots } from "./kalman-progress-smoother";
import { intervalIndexAt } from "./sorted-search";
import { msToSeconds } from "./units";

const EXTRAPOLATION_LIMIT_MS = 1000;
const MONOTONE_TANGENT_LIMIT = 3;

export interface ProgressSample {
  distance: number;
  speed: number;
}

function isotonicRegression(values: Float64Array): Float64Array {
  const count = values.length;
  const blockMeans = new Float64Array(count);
  const blockSizes = new Int32Array(count);
  let blocks = 0;

  for (let index = 0; index < count; index += 1) {
    blockMeans[blocks] = values[index];
    blockSizes[blocks] = 1;
    blocks += 1;
    while (blocks > 1 && blockMeans[blocks - 2] > blockMeans[blocks - 1]) {
      const mergedSize = blockSizes[blocks - 2] + blockSizes[blocks - 1];
      blockMeans[blocks - 2] =
        (blockMeans[blocks - 2] * blockSizes[blocks - 2] + blockMeans[blocks - 1] * blockSizes[blocks - 1]) /
        mergedSize;
      blockSizes[blocks - 2] = mergedSize;
      blocks -= 1;
    }
  }

  const result = new Float64Array(count);
  let position = 0;
  for (let block = 0; block < blocks; block += 1) {
    result.fill(blockMeans[block], position, position + blockSizes[block]);
    position += blockSizes[block];
  }
  return result;
}

function limitTangentsForMonotonicity(times: Float64Array, distances: Float64Array, speeds: Float64Array): void {
  for (let index = 0; index < times.length - 1; index += 1) {
    const span = msToSeconds(times[index + 1] - times[index]);
    const secant = (distances[index + 1] - distances[index]) / span;
    if (secant <= 0) {
      speeds[index] = 0;
      speeds[index + 1] = 0;
      continue;
    }

    const alpha = speeds[index] / secant;
    const beta = speeds[index + 1] / secant;
    const magnitude = alpha * alpha + beta * beta;
    if (magnitude > MONOTONE_TANGENT_LIMIT * MONOTONE_TANGENT_LIMIT) {
      const factor = MONOTONE_TANGENT_LIMIT / Math.sqrt(magnitude);
      speeds[index] = factor * alpha * secant;
      speeds[index + 1] = factor * beta * secant;
    }
  }
}

export class ProgressCurve {
  private readonly times: Float64Array;
  private readonly distances: Float64Array;
  private readonly speeds: Float64Array;

  constructor(knots: ProgressKnots) {
    this.times = knots.times;
    this.distances = isotonicRegression(knots.distances);
    this.speeds = Float64Array.from(knots.speeds, (speed) => Math.max(0, speed));
    limitTangentsForMonotonicity(this.times, this.distances, this.speeds);
  }

  sample(t: number): ProgressSample {
    const { times, distances, speeds } = this;
    const last = times.length - 1;
    if (last === 0 || t <= times[0]) {
      return { distance: distances[0], speed: 0 };
    }
    if (t >= times[last]) {
      const elapsed = t - times[last];
      if (elapsed >= EXTRAPOLATION_LIMIT_MS) {
        return { distance: distances[last] + speeds[last] * msToSeconds(EXTRAPOLATION_LIMIT_MS), speed: 0 };
      }
      return { distance: distances[last] + speeds[last] * msToSeconds(elapsed), speed: speeds[last] };
    }

    const index = intervalIndexAt(times, t);
    const spanMs = times[index + 1] - times[index];
    const span = msToSeconds(spanMs);
    const u = (t - times[index]) / spanMs;
    const u2 = u * u;
    const u3 = u2 * u;
    const startDistance = distances[index];
    const endDistance = distances[index + 1];
    const startSlope = speeds[index] * span;
    const endSlope = speeds[index + 1] * span;

    return {
      distance:
        (2 * u3 - 3 * u2 + 1) * startDistance +
        (u3 - 2 * u2 + u) * startSlope +
        (-2 * u3 + 3 * u2) * endDistance +
        (u3 - u2) * endSlope,
      speed:
        ((6 * u2 - 6 * u) * startDistance +
          (3 * u2 - 4 * u + 1) * startSlope +
          (-6 * u2 + 6 * u) * endDistance +
          (3 * u2 - 2 * u) * endSlope) /
        span,
    };
  }
}
