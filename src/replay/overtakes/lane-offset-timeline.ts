const RAMP_IN_MS = 1500;
const RAMP_OUT_MS = 1800;
const MAX_LANE_OFFSET_METERS = 3.5;
const MS_PER_SECOND = 1000;

export interface LaneEpisode {
  start: number;
  end: number;
  amplitude: number;
}

export interface LaneOffsetSample {
  offset: number;
  rate: number;
}

function smootherstep(u: number): number {
  return u * u * u * (u * (u * 6 - 15) + 10);
}

function smootherstepSlope(u: number): number {
  return 30 * u * u * (1 - u) * (1 - u);
}

function envelope(episode: LaneEpisode, t: number): LaneOffsetSample {
  const rampInStart = episode.start - RAMP_IN_MS;
  const rampOutEnd = episode.end + RAMP_OUT_MS;
  if (t <= rampInStart || t >= rampOutEnd) {
    return { offset: 0, rate: 0 };
  }
  if (t < episode.start) {
    const u = (t - rampInStart) / RAMP_IN_MS;
    return { offset: smootherstep(u), rate: (smootherstepSlope(u) * MS_PER_SECOND) / RAMP_IN_MS };
  }
  if (t <= episode.end) {
    return { offset: 1, rate: 0 };
  }
  const u = (rampOutEnd - t) / RAMP_OUT_MS;
  return { offset: smootherstep(u), rate: (-smootherstepSlope(u) * MS_PER_SECOND) / RAMP_OUT_MS };
}

const HOLD_LANE_GAP_MS = RAMP_IN_MS + RAMP_OUT_MS + 1000;

function mergeSameSideEpisodes(episodes: LaneEpisode[]): LaneEpisode[] {
  const merged: LaneEpisode[] = [];
  for (const episode of [...episodes].sort((a, b) => a.start - b.start)) {
    const previous = merged.find(
      (candidate) =>
        Math.sign(candidate.amplitude) === Math.sign(episode.amplitude) &&
        episode.start - candidate.end <= HOLD_LANE_GAP_MS,
    );
    if (previous) {
      previous.end = Math.max(previous.end, episode.end);
      previous.amplitude =
        Math.sign(previous.amplitude) * Math.max(Math.abs(previous.amplitude), Math.abs(episode.amplitude));
    } else {
      merged.push({ ...episode });
    }
  }
  return merged;
}

export class LaneOffsetTimeline {
  private readonly episodes: LaneEpisode[];

  constructor(episodes: LaneEpisode[]) {
    this.episodes = mergeSameSideEpisodes(episodes);
  }

  sample(t: number): LaneOffsetSample {
    let offset = 0;
    let rate = 0;
    for (const episode of this.episodes) {
      const weight = envelope(episode, t);
      offset += episode.amplitude * weight.offset;
      rate += episode.amplitude * weight.rate;
    }
    if (Math.abs(offset) > MAX_LANE_OFFSET_METERS) {
      return { offset: Math.sign(offset) * MAX_LANE_OFFSET_METERS, rate: 0 };
    }
    return { offset, rate };
  }
}
