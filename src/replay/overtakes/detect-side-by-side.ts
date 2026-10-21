import type { DriverTrajectory, TrajectoryPose } from "../interpolation/driver-trajectory";
import { kmhToMetersPerSecond, openF1UnitsToMeters } from "../interpolation/units";
import { type LaneEpisode, LaneOffsetTimeline } from "./lane-offset-timeline";

const SAMPLE_STEP_MS = 50;
const OVERLAP_LONGITUDINAL_METERS = 8;
const OVERLAP_LATERAL_METERS = 4;
const MIN_RACING_SPEED_MPS = kmhToMetersPerSecond(30);
const MERGE_GAP_MS = 3000;
const REQUIRED_SEPARATION_METERS = 2.7;
const DATA_SIDE_THRESHOLD_METERS = 0.6;
const ATTACKER_SHARE = 0.65;
const CORNER_LOOKAHEAD_MS = 4000;
const CORNER_MIN_HEADING_CHANGE = 0.1;

interface PairSample {
  t: number;
  longitudinal: number;
  lateral: number;
}

interface PairRun {
  samples: PairSample[];
}

interface PlanarPose {
  x: number;
  z: number;
  heading: number;
  speed: number;
}

function toPlanar(pose: TrajectoryPose): PlanarPose {
  return {
    x: openF1UnitsToMeters(pose.x),
    z: -openF1UnitsToMeters(pose.z),
    heading: pose.heading,
    speed: pose.speed,
  };
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function relativeOffset(reference: PlanarPose, other: PlanarPose): { longitudinal: number; lateral: number } {
  const dx = other.x - reference.x;
  const dz = other.z - reference.z;
  const cos = Math.cos(reference.heading);
  const sin = Math.sin(reference.heading);
  return { longitudinal: dx * cos + dz * sin, lateral: -dx * sin + dz * cos };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function collectRuns(samples: PairSample[]): PairRun[] {
  const runs: PairRun[] = [];
  for (const sample of samples) {
    const last = runs[runs.length - 1];
    const lastSample = last?.samples[last.samples.length - 1];
    if (last && lastSample && sample.t - lastSample.t <= MERGE_GAP_MS) {
      last.samples.push(sample);
    } else {
      runs.push({ samples: [sample] });
    }
  }
  return runs;
}

function insideSideFor(trajectory: DriverTrajectory, t: number): number {
  const change = wrapAngle(trajectory.poseAt(t + CORNER_LOOKAHEAD_MS).heading - trajectory.poseAt(t).heading);
  if (Math.abs(change) < CORNER_MIN_HEADING_CHANGE) {
    return 1;
  }
  return Math.sign(change);
}

function addEpisodes(
  run: PairRun,
  reference: number,
  other: number,
  trajectories: Map<number, DriverTrajectory>,
  episodes: Map<number, LaneEpisode[]>,
): void {
  const first = run.samples[0];
  const start = first.t;
  const end = run.samples[run.samples.length - 1].t;
  const otherAttacks = first.longitudinal < 0;
  const attacker = otherAttacks ? other : reference;
  const existing = median(run.samples.map((sample) => sample.lateral));

  let otherSide: number;
  if (Math.abs(existing) >= DATA_SIDE_THRESHOLD_METERS) {
    otherSide = Math.sign(existing);
  } else {
    const inside = insideSideFor(trajectories.get(attacker) as DriverTrajectory, start);
    otherSide = otherAttacks ? inside : -inside;
  }

  const needed = Math.max(0, REQUIRED_SEPARATION_METERS - otherSide * existing);
  if (needed === 0) {
    return;
  }

  const otherShare = otherAttacks ? ATTACKER_SHARE : 1 - ATTACKER_SHARE;
  episodes.get(other)?.push({ start, end, amplitude: otherSide * needed * otherShare });
  episodes.get(reference)?.push({ start, end, amplitude: -otherSide * needed * (1 - otherShare) });
}

export function* buildLaneOffsetTimelineSteps(
  trajectories: Map<number, DriverTrajectory>,
  duration: number,
): Generator<number, Map<number, LaneOffsetTimeline>> {
  const drivers = [...trajectories.keys()];
  const pairSamples = new Map<string, PairSample[]>();
  const episodes = new Map<number, LaneEpisode[]>(drivers.map((driver) => [driver, []]));

  for (let t = 0; t <= duration; t += SAMPLE_STEP_MS) {
    const poses = drivers.map((driver) => toPlanar((trajectories.get(driver) as DriverTrajectory).poseAt(t)));
    for (let a = 0; a < drivers.length; a += 1) {
      for (let b = a + 1; b < drivers.length; b += 1) {
        if (poses[a].speed < MIN_RACING_SPEED_MPS || poses[b].speed < MIN_RACING_SPEED_MPS) {
          continue;
        }
        const { longitudinal, lateral } = relativeOffset(poses[a], poses[b]);
        if (Math.abs(longitudinal) >= OVERLAP_LONGITUDINAL_METERS || Math.abs(lateral) >= OVERLAP_LATERAL_METERS) {
          continue;
        }
        const key = `${a}:${b}`;
        const list = pairSamples.get(key) ?? [];
        list.push({ t, longitudinal, lateral });
        pairSamples.set(key, list);
      }
    }
    if (t % (SAMPLE_STEP_MS * 1000) === 0) yield 0.9 * t / Math.max(1, duration);
  }

  let completed = 0;
  for (const [key, samples] of pairSamples) {
    const [a, b] = key.split(":").map(Number);
    for (const run of collectRuns(samples)) {
      addEpisodes(run, drivers[a], drivers[b], trajectories, episodes);
    }
    completed += 1;
    if (completed % 8 === 0 || completed === pairSamples.size) {
      yield 0.9 + 0.1 * completed / pairSamples.size;
    }
  }

  return new Map(drivers.map((driver) => [driver, new LaneOffsetTimeline(episodes.get(driver) ?? [])]));
}

export function buildLaneOffsetTimelines(
  trajectories: Map<number, DriverTrajectory>,
  duration: number,
): Map<number, LaneOffsetTimeline> {
  const steps = buildLaneOffsetTimelineSteps(trajectories, duration);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
