import type { ReplaySegment } from "../types";
import type { RaceCatalogEntry } from "./races-catalog";

export type ReplayLoadProgress = (loadedBytes: number, totalBytes: number | null) => void;

export async function loadReplaySegment(path: string, onProgress?: ReplayLoadProgress): Promise<ReplaySegment> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(
      `No se pudo cargar ${path}. Ejecuta "npm run sync:data" para generarlo desde OpenF1.`,
    );
  }
  let segment: ReplaySegment;
  if (onProgress && response.body) {
    const size = Number(response.headers.get("content-length"));
    const encoding = response.headers.get("content-encoding");
    const total = size > 0 && (!encoding || encoding === "identity") ? size : null;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parts: string[] = [];
    let loaded = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        loaded += value.byteLength;
        parts.push(decoder.decode(value, { stream: true }));
        onProgress(loaded, total);
      }
      parts.push(decoder.decode());
      onProgress(loaded, loaded);
    } finally {
      reader.releaseLock();
    }
    segment = JSON.parse(parts.join("")) as ReplaySegment;
  } else {
    segment = (await response.json()) as ReplaySegment;
  }
  return {
    ...segment,
    raceControl: segment.raceControl ?? [],
    startingGrid: segment.startingGrid ?? [],
    trackStatus: segment.trackStatus ?? [],
  };
}

export async function loadReplaySegmentFromRace(entry: RaceCatalogEntry, onProgress?: ReplayLoadProgress): Promise<ReplaySegment> {
  const segment = await loadReplaySegment(entry.path, onProgress);
  return {
    ...segment,
    sessionRef: {
      ...segment.sessionRef,
      totalLaps: entry.totalLaps ?? segment.sessionRef.totalLaps ?? null,
    },
  };
}
