import type { GhostCapture, ReplaySegment } from "../types";
import { publicUrl } from "../public-url";
import type { RaceCatalogEntry } from "./races-catalog";
import { decodeGhostCaptureBinary, decodeReplaySegmentBinary } from "./replay-segment-binary";
import { resolveStartingGrid } from "./starting-grid";

export type ReplayLoadProgress = (loadedBytes: number, totalBytes: number | null) => void;

function normalizeSegment(segment: ReplaySegment): ReplaySegment {
  return {
    ...segment,
    raceControl: segment.raceControl ?? [],
    startingGrid: resolveStartingGrid(segment),
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

async function loadReplayBytes(path: string, onProgress?: ReplayLoadProgress): Promise<Uint8Array> {
  const response = await fetch(publicUrl(path));
  if (!response.ok) {
    throw new Error(
      `No se pudo cargar ${path}. Ejecuta "npm run sync:data" para generarlo desde OpenF1.`,
    );
  }
  return readResponseBytes(response, onProgress);
}

export async function loadReplayCapture(entry: RaceCatalogEntry, onProgress?: ReplayLoadProgress) {
  const bytes = await loadReplayBytes(entry.path, onProgress);
  const segment = normalizeSegment(decodeReplaySegmentBinary(bytes));
  return {
    bytes,
    segment: {
      ...segment,
      sessionRef: {
        ...segment.sessionRef,
        totalLaps: entry.totalLaps ?? segment.sessionRef.totalLaps ?? null,
      },
    },
  };
}

export async function loadGhostCapture(entry: RaceCatalogEntry): Promise<GhostCapture> {
  const response = await fetch(publicUrl(`data/ghost-laps/${entry.sessionKey}.bin`));
  if (!response.ok) throw new Error("Todavía no hay vueltas fantasma para esta carrera.");
  const capture = decodeGhostCaptureBinary(await response.arrayBuffer());
  if (capture.sessionRef.sessionKey !== entry.sessionKey || capture.ghostLaps.length === 0) {
    throw new Error("No hay vueltas válidas con trayectoria completa para esta carrera.");
  }
  return capture;
}
