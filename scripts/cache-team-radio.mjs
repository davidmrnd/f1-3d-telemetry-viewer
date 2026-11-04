import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function writeAtomically(file, bytes) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

function isMp3(bytes) {
  return bytes.length >= 100 && (bytes.toString("ascii", 0, 3) === "ID3"
    || (bytes[0] === 255 && (bytes[1] & 224) === 224));
}

async function downloadAudio(url, file) {
  try {
    if (isMp3(await readFile(file))) return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!isMp3(bytes)) throw new Error("el archivo recibido no es un MP3 válido");
      await writeAtomically(file, bytes);
      return;
    } catch (error) {
      if (attempt === 3) throw new Error(`No se pudo descargar ${url}: ${error.message}`, { cause: error });
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
}

export async function cacheTeamRadio(segment, snapshotFile, snapshotPath, fetchJson, buildUrl) {
  const { startIso, endIso } = segment.timeRange;
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  const url = buildUrl("team_radio", { session_key: segment.sessionRef.sessionKey });
  const rows = await fetchJson(url, { emptyOnNotFound: true });
  const recordings = rows.map(row => ({ row, date: Date.parse(row.date) }))
    .filter(({ date }) => date >= start && date <= end)
    .sort((a, b) => a.date - b.date);

  const radioDir = join(dirname(snapshotFile), "radio");
  const radioPath = `${snapshotPath.slice(0, snapshotPath.lastIndexOf("/"))}/radio`;
  const clips = new Map();
  if (recordings.length) await mkdir(radioDir, { recursive: true });
  for (const { row, date } of recordings) {
    const source = new URL(row.recording_url);
    const name = source.pathname.split("/").at(-1);
    if (source.origin !== "https://livetiming.formula1.com" || !/^[\w-]+\.mp3$/i.test(name)) {
      throw new Error(`Origen de radio inesperado: ${source}`);
    }
    if (clips.has(name)) continue;
    await downloadAudio(source, join(radioDir, name));
    clips.set(name, { driverNumber: row.driver_number, time: date - start, audioPath: `${radioPath}/${name}` });
  }
  return [...clips.values()];
}
