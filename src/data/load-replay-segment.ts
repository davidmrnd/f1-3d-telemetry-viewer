import type { ReplaySegment } from "../types";

const REPLAY_SEGMENT_URL = "/data/replay-segment.json";

export async function loadReplaySegment(): Promise<ReplaySegment> {
  const response = await fetch(REPLAY_SEGMENT_URL);
  if (!response.ok) {
    throw new Error(
      `No se pudo cargar ${REPLAY_SEGMENT_URL}. Ejecuta "npm run sync:data" para generarlo desde OpenF1.`,
    );
  }
  const segment = (await response.json()) as ReplaySegment;
  return {
    ...segment,
    raceControl: segment.raceControl ?? [],
    startingGrid: segment.startingGrid ?? [],
    trackStatus: segment.trackStatus ?? [],
  };
}
