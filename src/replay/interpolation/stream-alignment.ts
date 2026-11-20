import type { LocationFix } from "./location-fixes";
import type { TelemetrySpeedProfile } from "./telemetry-speed-profile";
import { msToSeconds } from "./units";

const LAG_SEARCH_LIMIT_MS = 400;
const LAG_SEARCH_STEP_MS = 10;
const ALIGNMENT_WINDOW_MS = 1500;
const ALIGNMENT_MIN_DISTANCE_METERS = 10;
const ALIGNMENT_HUBER_DELTA_METERS = 5;
const SPEED_SCALE_MIN_DISTANCE_METERS = 100;
const SPEED_SCALE_MIN = 0.95;
const SPEED_SCALE_MAX = 1.05;
const JITTER_MIN_SPEED_MPS = 15;
const JITTER_MIN_SECONDS = 0.03;
const JITTER_MAX_SECONDS = 0.15;
const JITTER_DEFAULT_SECONDS = 0.05;

export interface AlignmentTrack {
  fixes: LocationFix[];
  fixArcLengths: Float64Array;
  telemetry: TelemetrySpeedProfile;
}

interface AlignmentCost {
  total: number;
  count: number;
}

interface AlignmentSamples {
  times: Float64Array;
  arcLengths: Float64Array;
  telemetry: TelemetrySpeedProfile;
  distances: Float64Array;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function huberLoss(residual: number): number {
  const magnitude = Math.abs(residual);
  return magnitude <= ALIGNMENT_HUBER_DELTA_METERS
    ? 0.5 * residual * residual
    : ALIGNMENT_HUBER_DELTA_METERS * (magnitude - 0.5 * ALIGNMENT_HUBER_DELTA_METERS);
}

function alignmentCost({ times, arcLengths, telemetry, distances }: AlignmentSamples, lagMs: number): AlignmentCost {
  telemetry.fillCumulativeDistances(times, lagMs, distances);
  let total = 0;
  let count = 0;
  let windowEnd = 0;

  for (let start = 0; start < times.length; start += 1) {
    windowEnd = Math.max(windowEnd, start + 1);
    while (windowEnd < times.length && times[windowEnd] - times[start] < ALIGNMENT_WINDOW_MS) {
      windowEnd += 1;
    }
    if (windowEnd >= times.length) {
      break;
    }

    const expected = distances[windowEnd] - distances[start];
    if (expected < ALIGNMENT_MIN_DISTANCE_METERS) {
      continue;
    }
    total += huberLoss(arcLengths[windowEnd] - arcLengths[start] - expected);
    count += 1;
  }

  return { total, count };
}

export function estimateTelemetryLagMs(tracks: AlignmentTrack[]): number {
  const samples: AlignmentSamples[] = tracks.map(({ fixes, fixArcLengths, telemetry }) => ({
    times: Float64Array.from(fixes, fix => fix.t),
    arcLengths: fixArcLengths,
    telemetry,
    distances: new Float64Array(fixes.length),
  }));
  let bestLag = 0;
  let bestCost = Number.POSITIVE_INFINITY;

  for (let lag = -LAG_SEARCH_LIMIT_MS; lag <= LAG_SEARCH_LIMIT_MS; lag += LAG_SEARCH_STEP_MS) {
    let total = 0;
    let count = 0;
    for (const sample of samples) {
      const cost = alignmentCost(sample, lag);
      total += cost.total;
      count += cost.count;
    }
    if (count === 0) {
      continue;
    }
    const meanCost = total / count;
    if (meanCost < bestCost) {
      bestCost = meanCost;
      bestLag = lag;
    }
  }

  return bestLag;
}

export function estimateSpeedScale(track: AlignmentTrack, lagMs: number): number {
  const { fixes, fixArcLengths, telemetry } = track;
  if (fixes.length < 2) {
    return 1;
  }

  const last = fixes.length - 1;
  const integrated = telemetry.distanceBetween(fixes[0].t + lagMs, fixes[last].t + lagMs);
  if (integrated < SPEED_SCALE_MIN_DISTANCE_METERS) {
    return 1;
  }
  return clamp((fixArcLengths[last] - fixArcLengths[0]) / integrated, SPEED_SCALE_MIN, SPEED_SCALE_MAX);
}

export function estimateTimingJitterSeconds(track: AlignmentTrack, lagMs: number, speedScale: number): number {
  const { fixes, fixArcLengths, telemetry } = track;
  let sumSq = 0;
  let count = 0;

  for (let index = 1; index < fixes.length; index += 1) {
    const elapsed = msToSeconds(fixes[index].t - fixes[index - 1].t);
    if (elapsed <= 0) {
      continue;
    }
    const integrated = speedScale * telemetry.distanceBetween(fixes[index - 1].t + lagMs, fixes[index].t + lagMs);
    const meanSpeed = integrated / elapsed;
    if (meanSpeed < JITTER_MIN_SPEED_MPS) {
      continue;
    }
    const timingError = (fixArcLengths[index] - fixArcLengths[index - 1]) / meanSpeed - elapsed;
    sumSq += timingError * timingError;
    count += 1;
  }

  if (count === 0) {
    return JITTER_DEFAULT_SECONDS;
  }
  return clamp(Math.sqrt(sumSq / count) / Math.SQRT2, JITTER_MIN_SECONDS, JITTER_MAX_SECONDS);
}
