import type { ReplaySegment } from "../types";
import type { RaceCatalogEntry } from "./races-catalog";
import { decodeReplaySegmentBinary } from "./replay-segment-binary";

export type ReplayLoadProgress = (loadedBytes: number, totalBytes: number | null) => void;

function normalizeSegment(segment: ReplaySegment): ReplaySegment {
  return {
    ...segment,
    raceControl: segment.raceControl ?? [],
    startingGrid: segment.startingGrid ?? [],
    trackStatus: segment.trackStatus ?? [],
  };
}

async function readResponseBytes(response: Response, onProgress?: ReplayLoadProgress): Promise<Uint8Array> {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    onProgress?.(buffer.byteLength, buffer.byteLength);
    return new Uint8Array(buffer);
  }

  const size = Number(response.headers.get("content-length"));
  const encoding = response.headers.get("content-encoding");
  const total = size > 0 && (!encoding || encoding === "identity") ? size : null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.(loaded, total);
    }
  } finally {
    reader.releaseLock();
  }
  onProgress?.(loaded, loaded);

  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function loadReplaySegment(path: string, onProgress?: ReplayLoadProgress): Promise<ReplaySegment> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(
      `No se pudo cargar ${path}. Ejecuta "npm run sync:data" para generarlo desde OpenF1.`,
    );
  }
  const bytes = await readResponseBytes(response, onProgress);
  return normalizeSegment(decodeReplaySegmentBinary(bytes));
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
