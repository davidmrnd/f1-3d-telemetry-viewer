import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeCircuitPreview } from "./circuit-preview.mjs";
import { fetchRaceTotalLaps } from "./race-total-laps.mjs";
import { buildRaceOperations, enrichExistingSnapshots } from "./race-operations.mjs";
import { decodeReplaySegmentBinary, encodeReplaySegmentBinary } from "./replay-segment-binary.mjs";
import { cacheTeamRadio, writeAtomically } from "./cache-team-radio.mjs";

const OPEN_F1_BASE = "https://api.openf1.org/v1";
const DEFAULT_COUNTRY = "Spain";
const DEFAULT_YEAR = 2025;
const DEFAULT_SESSION_KEY = 9971;
const DEFAULT_DRIVER_FOR_TRACK = 1;
const DEFAULT_REPLAY_DURATION_MS = 5 * 60 * 1000;
const FETCH_CHUNK_MS = 45_000;
const SEGMENT_DRIVER_COUNT = 20;
const FORMATION_LEAD_MS = 2.5 * 60 * 1000;
const RACE_CONTROL_LOOKBACK_MS = 120_000;
const STANDING_SPEED_KMH = 5;
const LAUNCH_SPEED_KMH = 30;
const SPEED_PROBE_STEP_MS = 500;
const DEFAULT_SAMPLE_HZ = 2;
const OPENF1_MAX_PER_SECOND = 3;
const OPENF1_MAX_PER_MINUTE = 30;
const OPENF1_MAX_CONCURRENT = 3;

function createOpenF1RateLimiter({
  maxPerSecond = OPENF1_MAX_PER_SECOND,
  maxPerMinute = OPENF1_MAX_PER_MINUTE,
  maxConcurrent = OPENF1_MAX_CONCURRENT,
} = {}) {
  const recent = [];
  let active = 0;
  const waiters = [];

  function prune(now) {
    while (recent.length > 0 && now - recent[0] >= 60_000) {
      recent.shift();
    }
  }

  function delayUntilSlot(now) {
    prune(now);
    if (active >= maxConcurrent) {
      return null;
    }
    const inLastSecond = recent.filter((stamp) => now - stamp < 1_000);
    if (inLastSecond.length >= maxPerSecond) {
      return Math.max(1, 1_000 - (now - inLastSecond[0]) + 1);
    }
    if (recent.length >= maxPerMinute) {
      return Math.max(1, 60_000 - (now - recent[0]) + 1);
    }
    return 0;
  }

  function pump() {
    while (waiters.length > 0) {
      const now = Date.now();
      const waitMs = delayUntilSlot(now);
      if (waitMs == null) {
        return;
      }
      if (waitMs > 0) {
        setTimeout(pump, waitMs + 5);
        return;
      }
      const next = waiters.shift();
      active += 1;
      recent.push(Date.now());
      next();
    }
  }

  return {
    async schedule(task) {
      await new Promise((resolve) => {
        waiters.push(resolve);
        pump();
      });
      try {
        return await task();
      } finally {
        active -= 1;
        pump();
      }
    },
  };
}

const openF1Limiter = createOpenF1RateLimiter();

function parseCliOptions() {
  const options = {
    sessionKey: DEFAULT_SESSION_KEY,
    durationMs: DEFAULT_REPLAY_DURATION_MS,
    country: DEFAULT_COUNTRY,
    year: DEFAULT_YEAR,
    sampleHz: DEFAULT_SAMPLE_HZ,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--session-key=")) {
      options.sessionKey = Number.parseInt(arg.slice("--session-key=".length), 10);
    } else if (arg.startsWith("--duration=")) {
      const seconds = Number.parseInt(arg.slice("--duration=".length), 10);
      options.durationMs = seconds * 1000;
    } else if (arg.startsWith("--country=")) {
      options.country = arg.slice("--country=".length);
    } else if (arg.startsWith("--year=")) {
      options.year = Number.parseInt(arg.slice("--year=".length), 10);
    } else if (arg.startsWith("--sample-hz=")) {
      options.sampleHz = Number.parseFloat(arg.slice("--sample-hz=".length));
    }
  }

  if (!Number.isFinite(options.sessionKey) || options.sessionKey <= 0) {
    throw new Error("session_key invalido.");
  }
  if (!Number.isFinite(options.durationMs) || options.durationMs < 10_000) {
    throw new Error("duration debe ser al menos 10 segundos.");
  }
  if (!Number.isFinite(options.sampleHz) || options.sampleHz < 0) {
    throw new Error("sample-hz debe ser >= 0 (0 = sin downsample).");
  }

  return options;
}

function slugifyPathSegment(value) {
  const slug = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "race";
}

function buildRaceArtifactNames(meeting, session) {
  const year = meeting.year;
  const raceSlug = slugifyPathSegment(meeting.circuit_short_name);
  const sessionKey = session.session_key;
  const id = `${year}-${raceSlug}-${sessionKey}`;
  const fileName = `${raceSlug}-${year}-${sessionKey}.bin`;
  const relativeDir = `${year}/${raceSlug}`;
  const path = `/data/${relativeDir}/${fileName}`;
  return { year, raceSlug, sessionKey, id, fileName, relativeDir, path };
}

async function upsertRacesCatalog(dataRoot, entry) {
  const catalogPath = join(dataRoot, "races-catalog.json");
  let catalog = { races: [], activeId: null };
  try {
    catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  } catch {
  }

  const races = Array.isArray(catalog.races)
    ? catalog.races.filter((race) => race.id !== entry.id)
    : [];
  races.push(entry);
  races.sort((a, b) => {
    if (b.year !== a.year) {
      return b.year - a.year;
    }
    return String(a.circuitShortName).localeCompare(String(b.circuitShortName), "es");
  });

  const next = {
    races,
    activeId: entry.id,
  };
  await writeFile(catalogPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function downsampleSampleSeries(samples, maxHz) {
  if (!(maxHz > 0) || samples.length <= 2) {
    return samples;
  }

  const minIntervalMs = 1000 / maxHz;
  const kept = [samples[0]];
  let lastKeptT = samples[0].t;
  let lastKeptPosition = samples[0].position;

  for (let index = 1; index < samples.length - 1; index += 1) {
    const sample = samples[index];
    const positionChanged =
      sample.position != null &&
      lastKeptPosition != null &&
      sample.position !== lastKeptPosition;
    if (sample.t - lastKeptT < minIntervalMs && !positionChanged) {
      continue;
    }
    kept.push(sample);
    lastKeptT = sample.t;
    lastKeptPosition = sample.position ?? lastKeptPosition;
  }

  const last = samples[samples.length - 1];
  if (kept[kept.length - 1].t !== last.t) {
    kept.push(last);
  }
  return kept;
}

function downsampleSamplesMap(samples, maxHz) {
  if (!(maxHz > 0)) {
    return samples;
  }
  return Object.fromEntries(
    Object.entries(samples).map(([driverNumber, series]) => [
      driverNumber,
      downsampleSampleSeries(series, maxHz),
    ]),
  );
}

function findFormationStartMs(raceControlEvents) {
  const started = raceControlEvents.find(
    (event) =>
      event.category === "SessionStatus" && /SESSION\s+STARTED/i.test(event.message ?? ""),
  );
  return started ? toTimestamp(started.date) : null;
}

function computeReplayWindow({ formationStartMs, candidate, session, durationMs }) {
  if (formationStartMs != null) {
    const sessionFloor = toTimestamp(session.date_start);
    const rangeStart = Math.max(sessionFloor, formationStartMs - FORMATION_LEAD_MS);
    return {
      rangeStart,
      rangeEnd: rangeStart + durationMs,
    };
  }

  const halfDuration = Math.floor(durationMs / 2);
  if (candidate) {
    return {
      rangeStart: candidate.at - halfDuration,
      rangeEnd: candidate.at + (durationMs - halfDuration),
    };
  }

  const rangeStart = toTimestamp(session.date_start) + 35_000;
  return {
    rangeStart,
    rangeEnd: rangeStart + durationMs,
  };
}

function buildUrl(path, params) {
  const url = new URL(`${OPEN_F1_BASE}/${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

async function fetchJson(url, { emptyOnNotFound = false } = {}) {
  return openF1Limiter.schedule(async () => {
    for (;;) {
      const response = await fetch(url);
      if (response.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, 1_200));
        continue;
      }
      if (!response.ok) {
        const body = await response.text();
        if (emptyOnNotFound && (response.status === 404 || body.includes("No results found"))) {
          return [];
        }
        throw new Error(`Request failed (${response.status}) for ${url}: ${body.slice(0, 240)}`);
      }
      return response.json();
    }
  });
}

async function fetchJsonTimeRange(path, params, rangeStart, rangeEnd) {
  if (rangeEnd <= rangeStart) {
    return [];
  }

  const windows = [];
  for (let chunkStart = rangeStart; chunkStart < rangeEnd; chunkStart += FETCH_CHUNK_MS) {
    windows.push({
      chunkStart,
      chunkEnd: Math.min(chunkStart + FETCH_CHUNK_MS, rangeEnd),
    });
  }

  const parts = await Promise.all(
    windows.map(({ chunkStart, chunkEnd }) => {
      const url = `${buildUrl(path, params)}&date>${encodeURIComponent(toIsoTime(chunkStart))}&date<${encodeURIComponent(toIsoTime(chunkEnd))}`;
      return fetchJson(url, { emptyOnNotFound: true });
    }),
  );

  const chunks = [];
  for (const data of parts) {
    if (Array.isArray(data) && data.length > 0) {
      chunks.push(...data);
    }
  }
  return chunks;
}

function groupByDriverNumber(rows) {
  const byDriver = new Map();
  for (const row of rows) {
    const driverNumber = row.driver_number;
    if (driverNumber == null) {
      continue;
    }
    const series = byDriver.get(driverNumber);
    if (series) {
      series.push(row);
    } else {
      byDriver.set(driverNumber, [row]);
    }
  }
  return byDriver;
}

function toTimestamp(isoTime) {
  return new Date(isoTime).getTime();
}

function toIsoTime(timestamp) {
  return new Date(timestamp).toISOString();
}

function parseGap(value) {
  if (typeof value === "number") {
    return value;
  }
  if (value == null || typeof value !== "string" || value.includes("LAP")) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function groupByDate(positions) {
  const snapshots = new Map();
  positions.forEach((item) => {
    const t = toTimestamp(item.date);
    const bucket = snapshots.get(t) ?? [];
    bucket.push(item);
    snapshots.set(t, bucket);
  });

  return [...snapshots.entries()]
    .map(([t, items]) => ({
      t,
      items: items.sort((a, b) => a.position - b.position),
    }))
    .sort((a, b) => a.t - b.t);
}

function detectCandidateEvent(positions, drivers) {
  const snapshots = groupByDate(positions);
  const driversByNumber = new Map(drivers.map((driver) => [driver.driverNumber, driver]));

  for (let index = 1; index < snapshots.length; index += 1) {
    const previous = snapshots[index - 1].items;
    const current = snapshots[index].items;
    const previousMap = new Map(previous.map((item) => [item.driver_number, item.position]));
    const changes = current
      .map((item) => {
        const before = previousMap.get(item.driver_number);
        return before && before !== item.position
          ? { driver: item.driver_number, before, after: item.position }
          : null;
      })
      .filter(Boolean);

    if (changes.length < 2) {
      continue;
    }

    for (const rising of changes.filter((change) => change.after < change.before)) {
      const swapped = changes.find(
        (change) => change.driver !== rising.driver && change.before === rising.after && change.after === rising.before,
      );
      if (!swapped) {
        continue;
      }

      const attacker = driversByNumber.get(rising.driver);
      const defender = driversByNumber.get(swapped.driver);
      return {
        at: snapshots[index].t,
        drivers: [rising.driver, swapped.driver],
        label: attacker && defender ? `${attacker.acronym} pasa a ${defender.acronym}` : "Cambio de posicion",
      };
    }
  }

  return null;
}

function buildSnapshotAtTime(positions, timestamp) {
  const latestByDriver = new Map();
  positions
    .slice()
    .sort((a, b) => toTimestamp(a.date) - toTimestamp(b.date))
    .forEach((position) => {
      if (toTimestamp(position.date) <= timestamp) {
        latestByDriver.set(position.driver_number, position);
      }
    });
  return [...latestByDriver.values()].sort((a, b) => a.position - b.position);
}

function pickReplayDrivers(snapshot, eventDrivers) {
  const sorted = snapshot.slice().sort((a, b) => a.position - b.position);
  if (sorted.length <= SEGMENT_DRIVER_COUNT) {
    return sorted.map((item) => item.driver_number);
  }
  if (!eventDrivers || eventDrivers.length === 0) {
    return sorted.slice(0, SEGMENT_DRIVER_COUNT).map((item) => item.driver_number);
  }

  const eventSet = new Set(eventDrivers);
  const eventPositions = sorted
    .filter((item) => eventSet.has(item.driver_number))
    .map((item) => item.position);
  if (eventPositions.length === 0) {
    return sorted.slice(0, SEGMENT_DRIVER_COUNT).map((item) => item.driver_number);
  }

  let min = Math.min(...eventPositions);
  let max = Math.max(...eventPositions);
  let selected = sorted.filter((item) => item.position >= min && item.position <= max);

  while (selected.length < SEGMENT_DRIVER_COUNT && (min > 1 || max < sorted[sorted.length - 1].position)) {
    if (min > 1) {
      min -= 1;
    }
    if (max < sorted[sorted.length - 1].position) {
      max += 1;
    }
    selected = sorted.filter((item) => item.position >= min && item.position <= max);
  }

  return selected.slice(0, SEGMENT_DRIVER_COUNT).map((item) => item.driver_number);
}

function binarySearchTimeline(points, t) {
  let low = 0;
  let high = points.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].t < t) {
      low = middle + 1;
    } else if (points[middle].t > t) {
      high = middle - 1;
    } else {
      return middle;
    }
  }
  return Math.max(0, low);
}

function sampleNumericPair(points, t, keys) {
  if (points.length === 0) {
    return Object.fromEntries(keys.map((key) => [key, 0]));
  }
  if (points.length === 1 || t <= points[0].t) {
    return { ...points[0].value };
  }
  if (t >= points[points.length - 1].t) {
    return { ...points[points.length - 1].value };
  }
  const index = binarySearchTimeline(points, t);
  const next = points[index];
  const previous = points[index - 1];
  if (!previous || !next || next.t === previous.t) {
    return { ...(next ?? previous).value };
  }
  const ratio = (t - previous.t) / (next.t - previous.t);
  return Object.fromEntries(keys.map((key) => [key, previous.value[key] + (next.value[key] - previous.value[key]) * ratio]));
}

function sampleStepped(points, t) {
  if (points.length === 0) {
    return null;
  }
  if (t <= points[0].t) {
    return points[0].value;
  }
  const index = binarySearchTimeline(points, t);
  const candidateIndex = index >= points.length ? points.length - 1 : index;
  const candidate = points[candidateIndex];
  if (candidate.t > t && candidateIndex > 0) {
    return points[candidateIndex - 1].value;
  }
  return candidate.value;
}

function buildTrackFromCorners(corners) {
  if (corners.length === 0) {
    return [];
  }
  const ordered = corners.slice().sort((a, b) => a.number - b.number);
  const centerX = ordered.reduce((sum, corner) => sum + corner.x, 0) / ordered.length;
  const centerY = ordered.reduce((sum, corner) => sum + corner.y, 0) / ordered.length;
  const extended = [];

  ordered.forEach((corner, index) => {
    const next = ordered[(index + 1) % ordered.length];
    const dx = next.x - corner.x;
    const dy = next.y - corner.y;
    extended.push({ x: corner.x, y: 0, z: corner.y });
    extended.push({
      x: corner.x + dx * 0.5 + (centerX - corner.x) * 0.08,
      y: 0,
      z: corner.y + dy * 0.5 + (centerY - corner.y) * 0.08,
    });
  });

  extended.push({ ...extended[0] });
  return extended;
}

function deriveLapTrack(lapLocations, fallbackCorners) {
  if (lapLocations.length > 24) {
    const simplified = lapLocations.filter((_, index) => index % 3 === 0);
    const first = simplified[0];
    const points = simplified.map((item) => ({
      x: item.x,
      y: item.z,
      z: item.y,
    }));
    if (first) {
      points.push({ x: first.x, y: first.z, z: first.y });
    }
    return points;
  }
  return buildTrackFromCorners(fallbackCorners);
}

function buildSampleSeries(driver, rangeStart, rangeEnd, location, telemetry, positions, intervals, stints) {
  const locationTimeline = location.map((point) => ({
    t: toTimestamp(point.date),
    value: { x: point.x, y: point.y, z: point.z },
  })).sort((a, b) => a.t - b.t);
  const telemetryTimeline = telemetry.map((point) => ({
    t: toTimestamp(point.date),
    value: {
      speed: point.speed,
      throttle: point.throttle,
      brake: point.brake,
      rpm: point.rpm,
      gear: point.n_gear,
      drs: point.drs,
    },
  })).sort((a, b) => a.t - b.t);
  const allDriverPositions = positions
    .filter((item) => item.driver_number === driver.driverNumber)
    .map((point) => ({ t: toTimestamp(point.date), value: point.position }))
    .sort((a, b) => a.t - b.t);
  const seededPosition = [...allDriverPositions].reverse().find((point) => point.t <= rangeStart) ?? null;
  const positionTimeline = [
    ...(seededPosition ? [seededPosition] : []),
    ...allDriverPositions.filter((point) => point.t > rangeStart && point.t <= rangeEnd),
  ];
  const intervalTimeline = intervals
    .filter((item) => item.driver_number === driver.driverNumber)
    .map((point) => ({
      t: toTimestamp(point.date),
      value: {
        gapToLeader: parseGap(point.gap_to_leader),
        intervalToAhead: parseGap(point.interval),
      },
    }))
    .sort((a, b) => a.t - b.t);
  const stint = stints.find((item) => item.driver_number === driver.driverNumber) ?? null;
  const timestamps = new Set();
  locationTimeline.forEach((point) => timestamps.add(point.t));
  telemetryTimeline.forEach((point) => timestamps.add(point.t));
  positionTimeline
    .filter((point) => point.t >= rangeStart && point.t <= rangeEnd)
    .forEach((point) => timestamps.add(point.t));

  return [...timestamps]
    .sort((a, b) => a - b)
    .map((timestamp) => {
      const locationValue = sampleNumericPair(locationTimeline, timestamp, ["x", "y", "z"]);
      const telemetryValue = sampleNumericPair(telemetryTimeline, timestamp, ["speed", "throttle", "brake", "rpm", "gear", "drs"]);
      const intervalValue = sampleStepped(intervalTimeline, timestamp) ?? { gapToLeader: null, intervalToAhead: null };

      return {
        t: timestamp - rangeStart,
        isoTime: toIsoTime(timestamp),
        driverNumber: driver.driverNumber,
        x: locationValue.x,
        y: locationValue.z,
        z: locationValue.y,
        speed: telemetryValue.speed,
        throttle: telemetryValue.throttle,
        brake: telemetryValue.brake,
        rpm: telemetryValue.rpm,
        gear: Math.round(telemetryValue.gear),
        drs: Math.round(telemetryValue.drs),
        position: sampleStepped(positionTimeline, timestamp),
        gapToLeader: intervalValue.gapToLeader,
        intervalToAhead: intervalValue.intervalToAhead,
        compound: stint?.compound ?? null,
        tyreAge: stint?.tyre_age_at_start ?? null,
      };
    });
}

async function resolveSessionContext(options) {
  const sessions = await fetchJson(buildUrl("sessions", { session_key: options.sessionKey }));
  const session = sessions[0];
  if (!session) {
    throw new Error(`No se encontro session_key ${options.sessionKey}.`);
  }

  const meetings = await fetchJson(buildUrl("meetings", { meeting_key: session.meeting_key }));
  const meeting = meetings[0];
  if (!meeting) {
    throw new Error(`No se encontro meeting_key ${session.meeting_key}.`);
  }

  return { meeting, session };
}

function isTrackWideScope(scope) {
  return scope == null || scope === "Track";
}

function normalizeRaceControlEvents(rawEvents, rangeStart, rangeEnd) {
  const minAbs = rangeStart - RACE_CONTROL_LOOKBACK_MS;
  return rawEvents
    .map((event) => {
      const absT = toTimestamp(event.date);
      return {
        t: absT - rangeStart,
        isoTime: event.date,
        category: event.category ?? "Other",
        flag: event.flag ?? null,
        message: event.message ?? "",
        scope: event.scope ?? null,
        lapNumber: event.lap_number ?? null,
        driverNumber: event.driver_number ?? null,
        absT,
      };
    })
    .filter((event) => event.absT >= minAbs && event.absT <= rangeEnd)
    .sort((a, b) => a.t - b.t || a.message.localeCompare(b.message));
}

function toPublicRaceControlEvents(events) {
  return events.map(({ t, isoTime, category, flag, message, scope, lapNumber, driverNumber }) => ({
    t,
    isoTime,
    category,
    flag,
    message,
    scope,
    lapNumber,
    driverNumber,
  }));
}

function normalizeStartingGrid(rawGrid) {
  return rawGrid
    .map((slot) => ({
      driverNumber: slot.driver_number,
      position: slot.position,
    }))
    .filter((slot) => Number.isFinite(slot.driverNumber) && Number.isFinite(slot.position))
    .sort((a, b) => a.position - b.position);
}

function sampleDriverSpeedAt(samples, driverNumber, t) {
  const series = samples[driverNumber];
  if (!series || series.length === 0) {
    return null;
  }
  if (t <= series[0].t) {
    return series[0].speed;
  }
  if (t >= series[series.length - 1].t) {
    return series[series.length - 1].speed;
  }
  const index = binarySearchTimeline(series, t);
  const next = series[index];
  const previous = series[index - 1];
  if (!previous || !next || next.t === previous.t) {
    return (next ?? previous).speed;
  }
  const ratio = (t - previous.t) / (next.t - previous.t);
  return previous.speed + (next.speed - previous.speed) * ratio;
}

function packMedianSpeed(samples, driverNumbers, t) {
  const speeds = driverNumbers
    .map((driverNumber) => sampleDriverSpeedAt(samples, driverNumber, t))
    .filter((speed) => speed != null && Number.isFinite(speed))
    .sort((a, b) => a - b);
  if (speeds.length === 0) {
    return null;
  }
  const mid = Math.floor(speeds.length / 2);
  return speeds.length % 2 === 0 ? (speeds[mid - 1] + speeds[mid]) / 2 : speeds[mid];
}

function isSafetyCarDeploy(message) {
  const text = message.toUpperCase();
  if (/ENDING|IN THE PIT|END OF|CANCEL/.test(text)) {
    return false;
  }
  return /DEPLOY|IN THIS AREA|SAFETY CAR/.test(text);
}

function isSafetyCarEnding(message) {
  const text = message.toUpperCase();
  return /ENDING|IN THE PIT|END OF/.test(text);
}

function phaseFromRaceControlEvent(event, state) {
  const message = event.message.toUpperCase();
  const flag = (event.flag ?? "").toUpperCase();

  if (event.category === "SessionStatus") {
    if (/SESSION\s+STARTED/.test(message)) {
      return {
        phase: "formation",
        flag: state.flag,
        procedureWindow: true,
        raceUnderway: false,
      };
    }
    if (/SESSION\s+FINISHED/.test(message)) {
      return {
        phase: "finished",
        flag: state.flag,
        procedureWindow: false,
        raceUnderway: state.raceUnderway,
      };
    }
  }

  if (event.category === "Drs" && /DRS\s+ENABLED/.test(message)) {
    return {
      phase: "racing",
      flag: state.flag,
      procedureWindow: false,
      raceUnderway: true,
    };
  }

  if (event.category === "SafetyCar") {
    if (isSafetyCarEnding(event.message)) {
      return {
        phase: state.raceUnderway ? "racing" : "formation",
        flag: state.flag,
        procedureWindow: state.procedureWindow,
        raceUnderway: state.raceUnderway,
      };
    }
    if (isSafetyCarDeploy(event.message)) {
      return {
        phase: "safety_car",
        flag: state.flag,
        procedureWindow: state.procedureWindow,
        raceUnderway: state.raceUnderway,
      };
    }
  }

  if (event.category === "Flag" && isTrackWideScope(event.scope)) {
    if (flag === "CHEQUERED") {
      return {
        phase: "finished",
        flag: event.flag,
        procedureWindow: false,
        raceUnderway: state.raceUnderway,
      };
    }
    if (flag === "RED") {
      return {
        phase: "red",
        flag: event.flag,
        procedureWindow: true,
        raceUnderway: false,
      };
    }
    if (flag === "YELLOW" || flag === "DOUBLE YELLOW") {
      return {
        phase: "yellow",
        flag: event.flag,
        procedureWindow: state.procedureWindow,
        raceUnderway: state.raceUnderway,
      };
    }
    if (flag === "GREEN" || flag === "CLEAR") {
      if (state.phase === "yellow" || state.phase === "safety_car" || state.phase === "red") {
        if (state.procedureWindow && !state.raceUnderway) {
          return {
            phase: "formation",
            flag: event.flag,
            procedureWindow: true,
            raceUnderway: false,
          };
        }
        return {
          phase: "racing",
          flag: event.flag,
          procedureWindow: false,
          raceUnderway: true,
        };
      }
      if (state.procedureWindow && !state.raceUnderway) {
        return {
          phase: "formation",
          flag: event.flag,
          procedureWindow: true,
          raceUnderway: false,
        };
      }
      if (state.raceUnderway) {
        return {
          phase: "racing",
          flag: event.flag,
          procedureWindow: false,
          raceUnderway: true,
        };
      }
      return null;
    }
  }

  return null;
}

function pushPhaseMarker(markers, t, phase, flag) {
  const last = markers[markers.length - 1];
  if (last && last.phase === phase && last.flag === flag) {
    return;
  }
  markers.push({ t, phase, flag });
}

function refineProcedureWithSpeed(markers, samples, driverNumbers, durationMs) {
  if (markers.length === 0) {
    return markers;
  }

  const refined = [];
  for (let index = 0; index < markers.length; index += 1) {
    const current = markers[index];
    const nextT = index + 1 < markers.length ? markers[index + 1].t : durationMs;
    pushPhaseMarker(refined, current.t, current.phase, current.flag);

    if (current.phase !== "formation" && current.phase !== "standing_start") {
      continue;
    }
    if (nextT <= 0) {
      continue;
    }

    const probeStart = Math.max(current.t, 0);
    const probeEnd = Math.min(nextT, durationMs);
    let localPhase = current.phase;

    for (let probe = probeStart; probe < probeEnd; probe += SPEED_PROBE_STEP_MS) {
      const median = packMedianSpeed(samples, driverNumbers, probe);
      if (median == null) {
        continue;
      }

      let nextPhase = localPhase;
      if (median <= STANDING_SPEED_KMH) {
        nextPhase = "standing_start";
      } else if (localPhase === "standing_start" && median >= LAUNCH_SPEED_KMH) {
        nextPhase = "racing";
      }

      if (nextPhase !== localPhase) {
        pushPhaseMarker(refined, probe, nextPhase, current.flag);
        localPhase = nextPhase;
        if (nextPhase === "racing") {
          break;
        }
      }
    }
  }

  return refined.sort((a, b) => a.t - b.t);
}

function markersToIntervals(markers, durationMs) {
  const sorted = markers.slice().sort((a, b) => a.t - b.t);
  let phaseAtStart = { phase: "pre_session", flag: null };
  for (const marker of sorted) {
    if (marker.t <= 0) {
      phaseAtStart = { phase: marker.phase, flag: marker.flag };
    }
  }

  const merged = [{ t: 0, phase: phaseAtStart.phase, flag: phaseAtStart.flag }];
  for (const marker of sorted) {
    if (marker.t <= 0 || marker.t >= durationMs) {
      continue;
    }
    pushPhaseMarker(merged, marker.t, marker.phase, marker.flag);
  }

  const intervals = [];
  for (let index = 0; index < merged.length; index += 1) {
    const start = merged[index].t;
    const end = index + 1 < merged.length ? merged[index + 1].t : durationMs;
    if (end <= start) {
      continue;
    }
    intervals.push({
      start,
      end,
      phase: merged[index].phase,
      flag: merged[index].flag,
    });
  }

  if (intervals.length === 0) {
    return [{ start: 0, end: durationMs, phase: "pre_session", flag: null }];
  }

  return intervals;
}

function sanitizePhasesAfterLaunch(markers) {
  let raceUnderway = false;
  const result = [];
  for (const marker of markers) {
    let phase = marker.phase;
    if (phase === "red") {
      raceUnderway = false;
    } else if (phase === "racing") {
      raceUnderway = true;
    } else if (phase === "finished") {
      raceUnderway = false;
    } else if (raceUnderway && (phase === "formation" || phase === "standing_start")) {
      phase = "racing";
    }
    pushPhaseMarker(result, marker.t, phase, marker.flag);
  }
  return result;
}

function deriveTrackStatus(raceControlEvents, samples, driverNumbers, durationMs) {
  let state = {
    phase: "pre_session",
    flag: null,
    procedureWindow: false,
    raceUnderway: false,
  };
  const markers = [{ t: -RACE_CONTROL_LOOKBACK_MS, phase: "pre_session", flag: null }];

  for (const event of raceControlEvents) {
    const transition = phaseFromRaceControlEvent(event, state);
    if (!transition) {
      continue;
    }
    state = {
      phase: transition.phase,
      flag: transition.flag,
      procedureWindow: transition.procedureWindow,
      raceUnderway: transition.raceUnderway,
    };
    pushPhaseMarker(markers, event.t, state.phase, state.flag);
  }

  const refined = refineProcedureWithSpeed(markers, samples, driverNumbers, durationMs);
  return markersToIntervals(sanitizePhasesAfterLaunch(refined), durationMs);
}

async function syncExistingRadios(dataRoot) {
  const catalog = JSON.parse(await readFile(join(dataRoot, "races-catalog.json"), "utf8"));
  const sessionArg = process.argv.find(arg => arg.startsWith("--session-key="));
  const sessionKey = sessionArg ? parseCliOptions().sessionKey : null;
  const races = catalog.races.filter(race => sessionKey === null || race.sessionKey === sessionKey);
  if (!races.length) throw new Error("No hay replays guardadas para actualizar.");
  for (const race of races) {
    const file = join(dataRoot, race.path.replace(/^\/data\//, ""));
    const segment = decodeReplaySegmentBinary(await readFile(file));
    segment.teamRadio = await cacheTeamRadio(segment, file, race.path, fetchJson, buildUrl);
    await writeAtomically(file, encodeReplaySegmentBinary(segment));
    console.log(`${race.race}: ${segment.teamRadio.length} radios guardadas.`);
  }
}

async function main() {
  const publicRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
  const dataRoot = join(publicRoot, "data");
  if (process.argv.includes("--radios-only")) {
    await syncExistingRadios(dataRoot);
    return;
  }
  if (process.argv.includes("--enrich-existing")) {
    await enrichExistingSnapshots(dataRoot, fetchJson, buildUrl);
    return;
  }
  const options = parseCliOptions();
  const { meeting, session } = await resolveSessionContext(options);
  const totalLaps = await fetchRaceTotalLaps(meeting);
  console.log(`Total previsto del Gran Premio: ${totalLaps} vueltas (ficha oficial de F1).`);
  const [rawDrivers, positions, rawRaceControl] = await Promise.all([
    fetchJson(buildUrl("drivers", { session_key: session.session_key })),
    fetchJson(buildUrl("position", { session_key: session.session_key })),
    fetchJson(buildUrl("race_control", { session_key: session.session_key }), { emptyOnNotFound: true }),
  ]);

  const drivers = rawDrivers.map((driver) => ({
    driverNumber: driver.driver_number,
    broadcastName: driver.broadcast_name,
    fullName: driver.full_name,
    acronym: driver.name_acronym,
    teamName: driver.team_name,
    teamColor: `#${driver.team_colour}`,
    headshotUrl: driver.headshot_url,
  })).sort((a, b) => a.driverNumber - b.driverNumber);

  const candidate = detectCandidateEvent(positions, drivers);
  const formationStartMs = findFormationStartMs(rawRaceControl);
  const { rangeStart, rangeEnd } = computeReplayWindow({
    formationStartMs,
    candidate,
    session,
    durationMs: options.durationMs,
  });
  const snapshot = buildSnapshotAtTime(positions, rangeStart);
  const selectedDriverNumbers = pickReplayDrivers(snapshot, candidate?.drivers ?? null);
  const selectedDrivers = selectedDriverNumbers.map((driverNumber) => drivers.find((driver) => driver.driverNumber === driverNumber)).filter(Boolean);

  const [intervals, stints, allLaps, circuitInfo, rawStartingGrid, rawPit, results] = await Promise.all([
    fetchJsonTimeRange("intervals", { session_key: session.session_key }, rangeStart, rangeEnd),
    fetchJson(buildUrl("stints", { session_key: session.session_key })),
    fetchJson(buildUrl("laps", { session_key: session.session_key })),
    meeting.circuit_info_url ? fetch(meeting.circuit_info_url).then((response) => response.json()) : null,
    fetchJson(buildUrl("starting_grid", { session_key: session.session_key }), { emptyOnNotFound: true }),
    fetchJson(buildUrl("pit", { session_key: session.session_key }), { emptyOnNotFound: true }),
    fetchJson(buildUrl("session_result", { session_key: session.session_key }), { emptyOnNotFound: true }),
  ]);

  const denseChunkCount = Math.max(1, Math.ceil((rangeEnd - rangeStart) / FETCH_CHUNK_MS));
  console.log(
    `Descargando location/car_data de todos los pilotos (${denseChunkCount} chunks × 2 endpoints ≈ ${denseChunkCount * 2} peticiones; máx ${OPENF1_MAX_CONCURRENT} concurrentes, ${OPENF1_MAX_PER_SECOND}/s, ${OPENF1_MAX_PER_MINUTE}/min)`,
  );
  const [allLocations, allCarData] = await Promise.all([
    fetchJsonTimeRange("location", { session_key: session.session_key }, rangeStart, rangeEnd),
    fetchJsonTimeRange("car_data", { session_key: session.session_key }, rangeStart, rangeEnd),
  ]);
  const locationsByDriver = groupByDriverNumber(allLocations);
  const carDataByDriver = groupByDriverNumber(allCarData);
  console.log(
    `Recibidos location=${allLocations.length} · car_data=${allCarData.length} · pilotos con location=${locationsByDriver.size} · con car_data=${carDataByDriver.size}`,
  );

  const corners = (circuitInfo?.corners ?? []).map((corner) => ({
    number: corner.number,
    angle: corner.angle,
    x: corner.trackPosition.x,
    y: corner.trackPosition.y,
  }));

  const laps = allLaps.filter((lap) => lap.driver_number === DEFAULT_DRIVER_FOR_TRACK);
  const candidateLap =
    laps.find((lap) => lap.lap_number === 2 && lap.lap_duration && !lap.is_pit_out_lap) ??
    laps.find((lap) => lap.lap_duration && !lap.is_pit_out_lap);

  let centerline = buildTrackFromCorners(corners);
  if (candidateLap?.lap_duration && candidateLap?.date_start) {
    const lapStart = toTimestamp(candidateLap.date_start);
    const lapEnd = lapStart + candidateLap.lap_duration * 1_000;
    const lapLocations =
      locationsByDriver.get(DEFAULT_DRIVER_FOR_TRACK)?.filter((point) => {
        const t = toTimestamp(point.date);
        return t >= lapStart && t <= lapEnd;
      }) ??
      (await fetchJson(
        `${buildUrl("location", { session_key: session.session_key, driver_number: DEFAULT_DRIVER_FOR_TRACK })}&date>${encodeURIComponent(toIsoTime(lapStart))}&date<${encodeURIComponent(toIsoTime(lapEnd))}`,
      ));
    centerline = deriveLapTrack(lapLocations, corners);
  }

  const samples = Object.fromEntries(
    selectedDrivers.map((driver) => [
      driver.driverNumber,
      buildSampleSeries(
        driver,
        rangeStart,
        rangeEnd,
        locationsByDriver.get(driver.driverNumber) ?? [],
        carDataByDriver.get(driver.driverNumber) ?? [],
        positions,
        intervals,
        stints,
      ),
    ]),
  );

  const raceControlNormalized = normalizeRaceControlEvents(rawRaceControl, rangeStart, rangeEnd);
  const raceControl = toPublicRaceControlEvents(raceControlNormalized);
  const startingGrid = normalizeStartingGrid(rawStartingGrid);
  const trackStatus = deriveTrackStatus(
    raceControlNormalized,
    samples,
    selectedDrivers.map((driver) => driver.driverNumber),
    rangeEnd - rangeStart,
  );
  const storedSamples = downsampleSamplesMap(samples, options.sampleHz);

  const payload = {
    sessionRef: {
      meetingKey: meeting.meeting_key,
      sessionKey: session.session_key,
      meetingName: meeting.meeting_name,
      circuitShortName: meeting.circuit_short_name,
      circuitInfoUrl: meeting.circuit_info_url ?? null,
      dateStart: session.date_start,
      dateEnd: session.date_end,
      year: meeting.year,
    },
    drivers: selectedDrivers,
    timeRange: {
      start: 0,
      end: rangeEnd - rangeStart,
      startIso: toIsoTime(rangeStart),
      endIso: toIsoTime(rangeEnd),
    },
    samples: storedSamples,
    events:
      candidate && candidate.at >= rangeStart && candidate.at <= rangeEnd
        ? [{
            type: "overtake",
            startTime: Math.max(0, candidate.at - rangeStart - 4_000),
            endTime: candidate.at - rangeStart + 6_000,
            drivers: candidate.drivers,
            label: candidate.label,
            metadata: {
              confidence: "position-swap",
              source: "snapshot",
            },
          }]
        : [],
    raceControl,
    startingGrid,
    trackStatus,
    circuit: {
      centerline,
      corners,
      rotation: circuitInfo?.rotation ?? 0,
    },
    notes: options.sampleHz > 0 ? [`sampleHz=${options.sampleHz}`] : [],
  };

  const operations = await buildRaceOperations(payload, rawPit, results, allLaps, stints, fetchJson, buildUrl);
  payload.pitStops = operations.pitStops;
  payload.tyreStints = operations.tyreStints;
  payload.retirements = operations.retirements;
  payload.circuit.pitLane = operations.pitLane;

  const artifact = buildRaceArtifactNames(meeting, session);
  const outputDir = join(dataRoot, String(artifact.year), artifact.raceSlug);
  await mkdir(outputDir, { recursive: true });
  const outputFile = join(outputDir, artifact.fileName);
  payload.teamRadio = await cacheTeamRadio(payload, outputFile, artifact.path, fetchJson, buildUrl);
  const binBuffer = encodeReplaySegmentBinary(payload);
  await writeAtomically(outputFile, binBuffer);
  console.log(`${payload.teamRadio.length} radios guardadas para el tramo.`);
  const circuitPreviewFile = await writeCircuitPreview(
    publicRoot,
    artifact.raceSlug,
    payload.circuit.centerline,
  );

  const durationSec = Math.round((rangeEnd - rangeStart) / 1000);
  await upsertRacesCatalog(dataRoot, {
    id: artifact.id,
    year: artifact.year,
    race: artifact.raceSlug,
    circuitShortName: meeting.circuit_short_name,
    meetingName: meeting.meeting_name,
    sessionKey: artifact.sessionKey,
    totalLaps,
    fileName: artifact.fileName,
    path: artifact.path,
    durationSec,
    updatedAt: new Date().toISOString(),
  });

  const sampleCounts = selectedDrivers.map((driver) => storedSamples[driver.driverNumber]?.length ?? 0);
  const binMb = (binBuffer.length / (1024 * 1024)).toFixed(2);
  console.log(
    `Snapshot binario escrito en ${outputFile} (${binMb} MB${
      options.sampleHz > 0 ? `, max ${options.sampleHz} Hz` : ""
    })`,
  );
  console.log(`Catálogo: /data/races-catalog.json · activa ${artifact.id}`);
  if (circuitPreviewFile) {
    console.log(`Silueta SVG escrita en ${circuitPreviewFile}`);
  } else {
    console.warn("No se pudo generar la silueta SVG: faltan puntos válidos del circuito.");
  }
  console.log(`${meeting.circuit_short_name} · session_key ${session.session_key} · ${durationSec}s · pilotos ${selectedDrivers.map((driver) => driver.acronym).join(", ")}`);
  console.log(
    `Ventana: ${toIsoTime(rangeStart)} -> ${toIsoTime(rangeEnd)}${
      formationStartMs != null
        ? ` (formación ${toIsoTime(formationStartMs)}, lead ${FORMATION_LEAD_MS / 1000}s)`
        : ""
    }`,
  );
  console.log(`Muestras por piloto: ${sampleCounts.join(", ")}`);
  console.log(`raceControl ${raceControl.length} · startingGrid ${startingGrid.length} · trackStatus ${trackStatus.length}`);
  console.log(`Fases: ${trackStatus.map((interval) => `${interval.phase}@${Math.round(interval.start / 1000)}s`).join(" → ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
