import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OPEN_F1_BASE = "https://api.openf1.org/v1";
const DEFAULT_COUNTRY = "Spain";
const DEFAULT_YEAR = 2024;
const DEFAULT_SESSION_KEY = 9539;
const DEFAULT_DRIVER_FOR_TRACK = 1;
const DEFAULT_REPLAY_DURATION_MS = 5 * 60 * 1000;
const FETCH_CHUNK_MS = 45_000;
const FETCH_CHUNK_DELAY_MS = 400;
const SEGMENT_DRIVER_COUNT = 4;

function parseCliOptions() {
  const options = {
    sessionKey: DEFAULT_SESSION_KEY,
    durationMs: DEFAULT_REPLAY_DURATION_MS,
    country: DEFAULT_COUNTRY,
    year: DEFAULT_YEAR,
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
    }
  }

  if (!Number.isFinite(options.sessionKey) || options.sessionKey <= 0) {
    throw new Error("session_key invalido.");
  }
  if (!Number.isFinite(options.durationMs) || options.durationMs < 10_000) {
    throw new Error("duration debe ser al menos 10 segundos.");
  }

  return options;
}

function computeReplayWindow(candidate, session, durationMs) {
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
  const response = await fetch(url);
  if (response.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    return fetchJson(url, { emptyOnNotFound });
  }
  if (response.status === 404 && emptyOnNotFound) {
    const body = await response.text();
    if (body.includes("No results found")) {
      return [];
    }
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Request failed (${response.status}) for ${url}: ${body.slice(0, 240)}`);
  }
  return response.json();
}

async function fetchJsonTimeRange(path, params, rangeStart, rangeEnd) {
  if (rangeEnd <= rangeStart) {
    return [];
  }

  const chunks = [];
  for (let chunkStart = rangeStart; chunkStart < rangeEnd; chunkStart += FETCH_CHUNK_MS) {
    const chunkEnd = Math.min(chunkStart + FETCH_CHUNK_MS, rangeEnd);
    const url = `${buildUrl(path, params)}&date>${encodeURIComponent(toIsoTime(chunkStart))}&date<${encodeURIComponent(toIsoTime(chunkEnd))}`;
    const data = await fetchJson(url, { emptyOnNotFound: true });
    if (Array.isArray(data) && data.length > 0) {
      chunks.push(...data);
    }
    if (chunkEnd < rangeEnd) {
      await new Promise((resolve) => setTimeout(resolve, FETCH_CHUNK_DELAY_MS));
    }
  }

  return chunks;
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
  if (!eventDrivers) {
    return sorted.slice(0, SEGMENT_DRIVER_COUNT).map((item) => item.driver_number);
  }
  const eventSet = new Set(eventDrivers);
  const eventPositions = sorted.filter((item) => eventSet.has(item.driver_number)).map((item) => item.position);
  const min = Math.max(1, Math.min(...eventPositions) - 1);
  const max = Math.max(...eventPositions) + 1;

  return sorted
    .filter((item) => item.position >= min && item.position <= max)
    .map((item) => item.driver_number)
    .slice(0, SEGMENT_DRIVER_COUNT);
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

async function main() {
  const options = parseCliOptions();
  const { meeting, session } = await resolveSessionContext(options);
  const [rawDrivers, positions] = await Promise.all([
    fetchJson(buildUrl("drivers", { session_key: session.session_key })),
    fetchJson(buildUrl("position", { session_key: session.session_key })),
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
  const { rangeStart, rangeEnd } = computeReplayWindow(candidate, session, options.durationMs);
  const snapshot = buildSnapshotAtTime(positions, candidate?.at ?? rangeStart);
  const selectedDriverNumbers = pickReplayDrivers(snapshot, candidate?.drivers ?? null);
  const selectedDrivers = selectedDriverNumbers.map((driverNumber) => drivers.find((driver) => driver.driverNumber === driverNumber)).filter(Boolean);

  const [intervals, stints, laps, circuitInfo] = await Promise.all([
    fetchJsonTimeRange("intervals", { session_key: session.session_key }, rangeStart, rangeEnd),
    fetchJson(buildUrl("stints", { session_key: session.session_key })),
    fetchJson(buildUrl("laps", { session_key: session.session_key, driver_number: DEFAULT_DRIVER_FOR_TRACK })),
    meeting.circuit_info_url ? fetch(meeting.circuit_info_url).then((response) => response.json()) : null,
  ]);

  const locationStreams = [];
  const telemetryStreams = [];
  for (const driver of selectedDrivers) {
    locationStreams.push(
      await fetchJsonTimeRange(
        "location",
        { session_key: session.session_key, driver_number: driver.driverNumber },
        rangeStart,
        rangeEnd,
      ),
    );
    telemetryStreams.push(
      await fetchJsonTimeRange(
        "car_data",
        { session_key: session.session_key, driver_number: driver.driverNumber },
        rangeStart,
        rangeEnd,
      ),
    );
  }

  const corners = (circuitInfo?.corners ?? []).map((corner) => ({
    number: corner.number,
    angle: corner.angle,
    x: corner.trackPosition.x,
    y: corner.trackPosition.y,
  }));

  const candidateLap =
    laps.find((lap) => lap.lap_number === 2 && lap.lap_duration && !lap.is_pit_out_lap) ??
    laps.find((lap) => lap.lap_duration && !lap.is_pit_out_lap);

  let centerline = buildTrackFromCorners(corners);
  if (candidateLap?.lap_duration && candidateLap?.date_start) {
    const lapStart = toTimestamp(candidateLap.date_start);
    const lapEnd = lapStart + candidateLap.lap_duration * 1_000;
    const lapLocations = await fetchJson(
      `${buildUrl("location", { session_key: session.session_key, driver_number: DEFAULT_DRIVER_FOR_TRACK })}&date>${encodeURIComponent(toIsoTime(lapStart))}&date<${encodeURIComponent(toIsoTime(lapEnd))}`,
    );
    centerline = deriveLapTrack(lapLocations, corners);
  }

  const samples = Object.fromEntries(
    selectedDrivers.map((driver, index) => [
      driver.driverNumber,
      buildSampleSeries(driver, rangeStart, rangeEnd, locationStreams[index], telemetryStreams[index], positions, intervals, stints),
    ]),
  );

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
    samples,
    events: candidate
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
    circuit: {
      centerline,
      corners,
      rotation: circuitInfo?.rotation ?? 0,
    },
    notes: [
    ],
  };

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outputDir = join(__dirname, "..", "public", "data");
  await mkdir(outputDir, { recursive: true });
  const outputFile = join(outputDir, "replay-segment.json");
  await writeFile(outputFile, JSON.stringify(payload, null, 2), "utf8");

  const durationSec = Math.round((rangeEnd - rangeStart) / 1000);
  const sampleCounts = selectedDrivers.map((driver) => samples[driver.driverNumber]?.length ?? 0);
  console.log(`Snapshot escrito en ${outputFile}`);
  console.log(`${meeting.circuit_short_name} · session_key ${session.session_key} · ${durationSec}s · pilotos ${selectedDrivers.map((driver) => driver.acronym).join(", ")}`);
  console.log(`Muestras por piloto: ${sampleCounts.join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
