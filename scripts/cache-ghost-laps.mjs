import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomically } from "./cache-team-radio.mjs";
import { decodeReplaySegmentBinary, encodeReplaySegmentBinary } from "./replay-segment-binary.mjs";

const LAP_MARGIN_MS = 8000;
const TIMED_LAP = /\bTIME\s+(\d+):(\d{2})\.(\d{3})\b/i;

function validLaps(laps, raceControl, pits) {
  const pitLaps = new Set(pits.map(stop => `${stop.driver_number}/${stop.lap_number}`));
  const candidates = laps.flatMap(lap => {
    const start = Date.parse(lap.date_start);
    const durationMs = Math.round(lap.lap_duration * 1000);
    const sectors = [lap.duration_sector_1, lap.duration_sector_2, lap.duration_sector_3];
    if (lap.lap_number <= 1 || lap.is_pit_out_lap || pitLaps.has(`${lap.driver_number}/${lap.lap_number}`)
      || !Number.isFinite(start) || !sectors.every(sector => sector > 0)
      || !Number.isFinite(durationMs) || durationMs <= 0) return [];
    return [{ driverNumber: lap.driver_number, lapNumber: lap.lap_number, start, durationMs }];
  });
  const deleted = new Set();
  for (const event of [...raceControl].sort((a, b) => Date.parse(a.date) - Date.parse(b.date))) {
    const message = event.message ?? "";
    const reinstated = /\bREINSTATED\b/i.test(message);
    if (!reinstated && !/\bDELETED\b/i.test(message)) continue;
    const driver = Number(message.match(/\bCAR\s+(\d+)\b/i)?.[1] ?? event.driver_number);
    const time = message.match(TIMED_LAP);
    const lapNumber = Number(message.match(/\bLAP\s+(\d+)\b/i)?.[1]);
    const duration = time ? (+time[1] * 60 + +time[2]) * 1000 + +time[3] : null;
    const matching = candidates.filter(lap => lap.driverNumber === driver &&
      (duration !== null ? lap.durationMs === duration : lap.lapNumber === lapNumber));
    const exact = matching.find(lap => lap.lapNumber === lapNumber);
    const closest = matching.sort((a, b) =>
      Math.abs(Date.parse(event.date) - a.start - a.durationMs) -
      Math.abs(Date.parse(event.date) - b.start - b.durationMs))[0];
    const lap = exact ?? (reinstated ? matching.find(candidate => deleted.has(candidate)) : undefined) ?? closest;
    if (lap && reinstated) deleted.delete(lap);
    else if (lap) deleted.add(lap);
  }
  return candidates.filter(lap => !deleted.has(lap)).sort((a, b) => a.durationMs - b.durationMs);
}

function coversLap(rows, start, end) {
  const times = [...new Set(rows.map(row => Date.parse(row.date)))].filter(Number.isFinite).sort((a, b) => a - b);
  return times.length >= 25 && times[0] <= start && times.at(-1) >= end &&
    times.every((time, index) => index === 0 || time <= start || times[index - 1] >= end || time - times[index - 1] < 2000);
}

export async function cacheGhostLaps(dataRoot, sessionKey, fetchJson, buildUrl, buildSampleSeries) {
  const catalog = JSON.parse(await readFile(join(dataRoot, "races-catalog.json"), "utf8"));
  const races = catalog.races.filter(race => !sessionKey || String(race.sessionKey) === sessionKey);
  if (races.length === 0) throw new Error("No se encontraron carreras para guardar sus vueltas fantasma.");
  const output = join(dataRoot, "ghost-laps");
  await mkdir(output, { recursive: true });
  for (const race of races) {
    const source = decodeReplaySegmentBinary(await readFile(join(dataRoot, race.path.slice("/data/".length))));
    const destination = join(output, `${race.sessionKey}.bin`);
    const previousBytes = await readFile(destination).catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    const previous = previousBytes ? decodeReplaySegmentBinary(previousBytes) : null;
    const previousLaps = new Map(previous?.ghostLaps?.map(lap => [lap.driverNumber, lap]));
    const params = { session_key: race.sessionKey };
    const request = (endpoint, filters = {}) => fetchJson(buildUrl(endpoint, { ...params, ...filters }), { emptyOnNotFound: true });
    const [laps, raceControl, pits] = await Promise.all([request("laps"), request("race_control"), request("pit")]);
    const ranked = validLaps(laps, raceControl, pits);
    console.log(`${race.circuitShortName}: preparando las mejores vueltas de carrera…`);
    const captured = (await Promise.all(source.drivers.map(async driver => {
      const lap = ranked.find(candidate => candidate.driverNumber === driver.driverNumber);
      if (!lap) return null;
      const { start, durationMs, ...timing } = lap;
      const cached = previousLaps.get(driver.driverNumber);
      const cachedSamples = previous?.samples[driver.driverNumber];
      if (cached?.lapNumber === lap.lapNumber && cached.durationMs === durationMs && cachedSamples?.length) {
        return { driver, samples: cachedSamples, lap: { ...timing, durationMs } };
      }
      const end = start + durationMs;
      const filters = {
        driver_number: driver.driverNumber,
        "date>": new Date(start - LAP_MARGIN_MS).toISOString(),
        "date<": new Date(end + LAP_MARGIN_MS).toISOString(),
      };
      const [locations, telemetry] = await Promise.all([request("location", filters), request("car_data", filters)]);
      if (!coversLap(locations, start, end) || !coversLap(telemetry, start, end)) {
        console.log(`  ${driver.acronym}: cobertura incompleta en la vuelta ${lap.lapNumber}.`);
        return null;
      }
      const samples = buildSampleSeries(driver, start, end, locations, telemetry, [], [], []);
      return { driver, samples, lap: { ...timing, durationMs } };
    }))).filter(Boolean);
    const bytes = encodeReplaySegmentBinary({
      sessionRef: source.sessionRef,
      drivers: captured.map(entry => entry.driver),
      ghostLaps: captured.map(entry => entry.lap),
      samples: Object.fromEntries(captured.map(entry => [entry.driver.driverNumber, entry.samples])),
    });
    await writeAtomically(destination, bytes);
    console.log(`  ${captured.length} vueltas listas · ${Math.round(bytes.length / 1024)} kB`);
  }
}
