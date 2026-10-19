import type { ReplaySegment } from "../types";
import type { RaceCatalogEntry } from "./races-catalog";

export async function loadReplaySegment(path: string): Promise<ReplaySegment> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(
      `No se pudo cargar ${path}. Ejecuta "npm run sync:data" para generarlo desde OpenF1.`,
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

export async function loadReplaySegmentFromRace(entry: RaceCatalogEntry): Promise<ReplaySegment> {
  return loadReplaySegment(entry.path);
}
