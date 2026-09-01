import type { ReplaySegment } from "../types";

const REPLAY_SEGMENT_URL = "/data/replay-segment.json";

/** Carga el snapshot local generado con `npm run sync:data`. */
export async function loadReplaySegment(): Promise<ReplaySegment> {
  const response = await fetch(REPLAY_SEGMENT_URL);
  if (!response.ok) {
    throw new Error(
      `No se pudo cargar ${REPLAY_SEGMENT_URL}. Ejecuta "npm run sync:data" para generarlo desde OpenF1.`,
    );
  }
  return (await response.json()) as ReplaySegment;
}
