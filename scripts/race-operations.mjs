import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeReplaySegmentBinary, encodeReplaySegmentBinary } from "./replay-segment-binary.mjs";
import { writeAtomically } from "./cache-team-radio.mjs";

const timestamp = (value) => value ? Date.parse(value) : NaN;
const finite = (value) => typeof value === "number" && Number.isFinite(value);

export function normalizePitStops(rows, samples, rangeStart, rangeEnd) {
  return rows.flatMap((row) => {
    const duration = row.lane_duration ?? row.pit_duration;
    const exit = timestamp(row.date);
    if (!finite(duration) || duration <= 0 || !finite(exit)) return [];
    const entry = exit - duration * 1000;
    if (exit < rangeStart || entry > rangeEnd) return [];
    const entryTime = entry - rangeStart;
    const exitTime = exit - rangeStart;
    const stopDuration = finite(row.stop_duration) && row.stop_duration > 0 && row.stop_duration <= duration
      ? row.stop_duration : null;
    const series = (samples[row.driver_number] ?? []).filter((sample) =>
      sample.t >= entryTime && sample.t <= exitTime && finite(sample.speed));
    const slowest = series.reduce((best, sample) => !best || sample.speed < best.speed ? sample : best, null);
    const stopped = slowest && slowest.speed <= 5
      ? series.filter((sample) => sample.speed <= 5 && Math.abs(sample.t - slowest.t) <= (stopDuration ?? 5) * 1000)
      : [];
    const stopStart = stopDuration && stopped.length
      ? Math.max(entryTime, Math.min(exitTime - stopDuration * 1000,
        (stopped[0].t + stopped.at(-1).t - stopDuration * 1000) / 2)) : null;
    return [{ driverNumber: row.driver_number, lapNumber: row.lap_number,
      entryTime, exitTime, laneDuration: duration, stopDuration,
      stopStart, stopEnd: stopStart === null ? null : stopStart + stopDuration * 1000 }];
  }).sort((a, b) => a.entryTime - b.entryTime);
}

export function normalizeTyreStints(stints, laps, pits, rangeStart) {
  return stints.flatMap((stint) => {
    const driverLaps = laps.filter((lap) => lap.driver_number === stint.driver_number)
      .sort((a, b) => a.lap_number - b.lap_number);
    const first = driverLaps.find((lap) => lap.lap_number >= stint.lap_start && lap.date_start);
    if (!first) return [];
    const pit = pits.find((pit) => pit.driverNumber === stint.driver_number && pit.lapNumber === stint.lap_start)
      ?? pits.find((pit) => pit.driverNumber === stint.driver_number && pit.lapNumber === stint.lap_start - 1);
    const startTime = stint.stint_number === 1 ? -Infinity
      : pit?.stopEnd ?? pit?.exitTime ?? timestamp(first.date_start) - rangeStart;
    return [{ driverNumber: stint.driver_number, startTime: Number.isFinite(startTime) ? startTime : -1e12,
      startLap: stint.lap_start, compound: stint.compound ?? null,
      tyreAge: stint.tyre_age_at_start ?? 0,
      lapTimes: driverLaps.filter((lap) => lap.lap_number >= stint.lap_start && lap.lap_number <= stint.lap_end)
        .map((lap) => timestamp(lap.date_start) - rangeStart).filter(Number.isFinite) }];
  }).sort((a, b) => a.startTime - b.startTime);
}

export function pitLaneFromSamples(samples) {
  const centerline = [];
  for (const sample of samples) {
    if (![sample.x, sample.y, sample.z].every(Number.isFinite)) continue;
    const last = centerline.at(-1);
    if (!last || Math.hypot(sample.x - last.x, sample.z - last.z) >= 20) {
      centerline.push({ x: sample.x, y: sample.y, z: sample.z });
    }
  }
  if (centerline.length < 6) return null;
  let length = 0;
  for (let i = 1; i < centerline.length; i++) {
    const distance = Math.hypot(centerline[i].x - centerline[i - 1].x, centerline[i].z - centerline[i - 1].z) * 0.1;
    if (distance > 100) return null;
    length += distance;
  }
  return length >= 80 && length <= 1800 ? { centerline, width: 9, source: "openf1_location" } : null;
}

export async function buildRaceOperations(segment, rawPit, results, laps, stints, fetchJson, buildUrl) {
  const rangeStart = timestamp(segment.timeRange.startIso);
  const rangeEnd = timestamp(segment.timeRange.endIso);
  const pitStops = normalizePitStops(rawPit, segment.samples, rangeStart, rangeEnd);
  const tyreStints = normalizeTyreStints(stints, laps, pitStops, rangeStart);
  let pitLane = null;
  for (const pit of [...pitStops].sort((a, b) => a.laneDuration - b.laneDuration)) {
    const samples = segment.samples[pit.driverNumber] ?? [];
    if (!samples.length || samples[0].t > pit.entryTime - 5000 || samples.at(-1).t < pit.exitTime + 6000) continue;
    pitLane = pitLaneFromSamples(samples.filter((sample) => sample.t >= pit.entryTime - 5000 && sample.t <= pit.exitTime + 6000));
    if (pitLane) break;
  }
  if (!pitLane) {
    const candidate = rawPit.filter((pit) => (pit.lane_duration ?? pit.pit_duration) > 10)
      .sort((a, b) => (a.lane_duration ?? a.pit_duration) - (b.lane_duration ?? b.pit_duration))[0];
    if (candidate) {
      const exit = timestamp(candidate.date);
      const entry = exit - (candidate.lane_duration ?? candidate.pit_duration) * 1000;
      const rows = await fetchJson(buildUrl("location", { session_key: segment.sessionRef.sessionKey,
        driver_number: candidate.driver_number, "date>": new Date(entry - 5000).toISOString(),
        "date<": new Date(exit + 6000).toISOString() }), { emptyOnNotFound: true });
      pitLane = pitLaneFromSamples(rows.sort((a, b) => timestamp(a.date) - timestamp(b.date))
        .map((row) => ({ x: row.x, y: row.z, z: row.y })));
    }
  }
  const retirements = [];
  for (const result of results) {
    if (!result.dnf && !result.dns) continue;
    if (!segment.drivers.some((driver) => driver.driverNumber === result.driver_number)) continue;
    if (result.dns) {
      retirements.push({ driverNumber: result.driver_number, t: 0, status: "dns", source: "session_result" });
      continue;
    }
    const driverLaps = laps.filter((lap) => lap.driver_number === result.driver_number && lap.date_start)
      .sort((a, b) => a.lap_number - b.lap_number);
    const lastLap = driverLaps.at(-1);
    const lastLapStart = lastLap ? timestamp(lastLap.date_start) : timestamp(segment.sessionRef.dateStart);
    if (lastLapStart > rangeEnd) continue;
    const params = { session_key: segment.sessionRef.sessionKey, driver_number: result.driver_number,
      "date>": new Date(lastLapStart).toISOString() };
    const telemetry = await fetchJson(buildUrl("car_data", params), { emptyOnNotFound: true });
    const moving = telemetry.filter((row) => row.speed > 5).sort((a, b) => timestamp(a.date) - timestamp(b.date));
    let at = moving.length ? timestamp(moving.at(-1).date) : NaN;
    let source = "last_telemetry";
    if (!finite(at)) {
      const locations = await fetchJson(buildUrl("location", params), { emptyOnNotFound: true });
      at = Math.max(...locations.map((row) => timestamp(row.date)).filter(Number.isFinite));
      source = "last_location";
    }
    if (finite(at) && at <= rangeEnd) retirements.push({ driverNumber: result.driver_number,
      t: Math.max(0, at - rangeStart), status: "dnf", source });
  }
  return { pitStops, tyreStints, retirements, pitLane };
}

export async function enrichExistingSnapshots(dataRoot, fetchJson, buildUrl) {
  const catalog = JSON.parse(await readFile(join(dataRoot, "races-catalog.json"), "utf8"));
  for (const race of catalog.races) {
    const file = join(dataRoot, race.path.replace(/^\/data\//, ""));
    const segment = decodeReplaySegmentBinary(await readFile(file));
    const rows = await Promise.all(["pit", "session_result", "laps", "stints"].map((endpoint) =>
      fetchJson(buildUrl(endpoint, { session_key: race.sessionKey }), { emptyOnNotFound: true })));
    const operations = await buildRaceOperations(segment, ...rows, fetchJson, buildUrl);
    segment.pitStops = operations.pitStops;
    segment.tyreStints = operations.tyreStints;
    segment.retirements = operations.retirements;
    segment.circuit.pitLane = operations.pitLane;
    await writeAtomically(file, encodeReplaySegmentBinary(segment));
    console.log(`${race.race}: ${operations.pitStops.length} pasos por boxes, ${operations.retirements.length} abandonos, pitlane ${operations.pitLane?.centerline.length ?? 0} puntos`);
  }
}
