import type { CarSample, RaceMilestone, ReplaySegment } from "../../types";
import { openF1UnitsToMeters } from "../interpolation/units";

function sampleAt(samples: CarSample[], time: number) {
  let low = 0, high = samples.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (samples[mid].t <= time) low = mid + 1;
    else high = mid;
  }
  return low > 0 ? samples[low - 1] : null;
}

function inPits(segment: ReplaySegment, driver: number, time: number) {
  return segment.pitStops?.some(pit => pit.driverNumber === driver
    && time >= pit.entryTime - 5000 && time <= pit.exitTime + 5000) ?? false;
}

function isRacing(segment: ReplaySegment, time: number) {
  const status = segment.trackStatus.find(status => time >= status.start && time < status.end);
  return !status || status.phase === "racing";
}

function buildOvertakes(segment: ReplaySegment): RaceMilestone[] {
  const milestones: RaceMilestone[] = [];
  const drivers = new Map(segment.drivers.map(driver => [driver.driverNumber, driver]));
  const changes: { driver: number; time: number }[] = [];
  for (const driver of segment.drivers) {
    const samples = segment.samples[driver.driverNumber] ?? [];
    for (let i = 1; i < samples.length; i++) {
      const before = samples[i - 1].position, after = samples[i].position;
      if (before != null && after != null && after < before) changes.push({ driver: driver.driverNumber, time: samples[i].t });
    }
  }
  changes.sort((a, b) => a.time - b.time);
  const lastPass = new Map<string, number>();
  for (const { driver: attacker, time } of changes) {
    if (time < 2000 || time + 3000 > segment.timeRange.end || !isRacing(segment, time) || inPits(segment, attacker, time)) continue;
    const series = segment.samples[attacker];
    const before = sampleAt(series, time - 2000), after = sampleAt(series, time + 3000);
    if (before?.position == null || after?.position == null || after.position >= before.position) continue;
    for (const defender of segment.drivers) {
      const number = defender.driverNumber;
      if (number === attacker || inPits(segment, number, time)) continue;
      const other = segment.samples[number] ?? [];
      const otherBefore = sampleAt(other, time - 2000), otherAfter = sampleAt(other, time + 3000);
      if (otherBefore?.position == null || otherAfter?.position == null
        || before.position <= otherBefore.position || after.position >= otherAfter.position
        || otherAfter.position <= otherBefore.position) continue;
      if ([before, otherBefore].some(sample => time - 2000 - sample.t > 3000)
        || [after, otherAfter].some(sample => time + 3000 - sample.t > 3000)) continue;
      const a = sampleAt(series, time), b = sampleAt(other, time);
      if (!a || !b || a.speed < 30 || b.speed < 30
        || openF1UnitsToMeters(Math.hypot(a.x - b.x, a.z - b.z)) > 120) continue;
      const key = [attacker, number].sort((a, b) => a - b).join(":");
      if (time - (lastPass.get(key) ?? -Infinity) < 6000) continue;
      lastPass.set(key, time);
      milestones.push({ id: `overtake:${attacker}:${number}:${time}`, kind: "overtake", time,
        drivers: [attacker, number], label: `${drivers.get(attacker)?.acronym} adelanta a ${defender.acronym}`,
        detail: "Detectado por intercambio de posiciones fuera de boxes", approximate: true });
    }
  }
  return milestones;
}

function lapStarts(segment: ReplaySegment) {
  const laps = new Map<number, { lap: number; time: number }[]>();
  for (const stint of segment.tyreStints ?? []) {
    const times = laps.get(stint.driverNumber) ?? [];
    stint.lapTimes.forEach((time, index) => times.push({ lap: stint.startLap + index, time }));
    laps.set(stint.driverNumber, times);
  }
  for (const times of laps.values()) times.sort((a, b) => a.time - b.time);
  return laps;
}

function offTrackMilestones(segment: ReplaySegment, laps: ReturnType<typeof lapStarts>): RaceMilestone[] {
  const incidents = new Map<string, RaceMilestone>();
  for (const event of segment.raceControl) {
    if (!/TRACK LIMITS|LEAVING THE TRACK|OFF TRACK|SPUN|SPIN|WENT OFF/i.test(event.message)) continue;
    if (/PENALTY|PENALTIES|BLACK AND WHITE|NO FURTHER ACTION|WARNING/i.test(event.message)) continue;
    const driver = event.driverNumber ?? Number(event.message.match(/CAR\s+(\d+)/i)?.[1]);
    const info = segment.drivers.find(info => info.driverNumber === driver);
    if (!info) continue;
    const lap = Number(event.message.match(/LAP\s+(\d+)/i)?.[1]);
    const turn = Number(event.message.match(/TURN\s+(\d+)/i)?.[1]);
    const times = laps.get(driver) ?? [];
    const start = times.find(item => item.lap === lap);
    const end = times.find(item => item.lap === lap + 1);
    const corner = segment.circuit.corners.find(corner => corner.number === turn);
    let time = event.t;
    let detail = "Instante del aviso de dirección de carrera";
    if (start) {
      time = start.time;
      detail = `Inicio de la vuelta ${lap}; el aviso no precisa el instante`;
      if (corner) {
        let closest = Infinity;
        for (const sample of segment.samples[driver] ?? []) {
          if (sample.t < start.time || sample.t >= Math.min(end?.time ?? event.t, event.t) || inPits(segment, driver, sample.t)) continue;
          const distance = Math.hypot(sample.x - corner.x, sample.z - corner.y);
          if (distance < closest) { closest = distance; time = sample.t; }
        }
        if (closest < 1000) detail = `Paso aproximado por la curva ${turn} · vuelta ${lap}`;
        else time = start.time;
      }
    }
    const key = `${driver}:${lap || event.t}:${turn || "incidente"}`;
    if (!incidents.has(key)) incidents.set(key, { id: `off_track:${key}`, kind: "off_track", time,
      drivers: [driver], label: `${info.acronym} · salida de pista${turn ? ` en curva ${turn}` : ""}`,
      detail, approximate: true });
  }
  return [...incidents.values()];
}

export function buildRaceMilestones(segment: ReplaySegment): RaceMilestone[] {
  const laps = lapStarts(segment);
  const milestones = buildOvertakes(segment);
  for (const driver of segment.drivers) {
    for (const { lap, time } of laps.get(driver.driverNumber) ?? []) {
      if (lap <= 1) continue;
      milestones.push({ id: `finish:${driver.driverNumber}:${lap}`, kind: "finish", time,
        drivers: [driver.driverNumber], label: `${driver.acronym} pasa por meta`,
        detail: `Vuelta ${lap - 1} completada`, approximate: false });
    }
  }
  for (const pit of segment.pitStops ?? []) {
    const driver = segment.drivers.find(driver => driver.driverNumber === pit.driverNumber);
    if (!driver) continue;
    milestones.push({ id: `pit_entry:${pit.driverNumber}:${pit.entryTime}`, kind: "pit_entry", time: pit.entryTime,
      drivers: [pit.driverNumber], label: `${driver.acronym} entra a boxes`,
      detail: `Vuelta ${pit.lapNumber}`, approximate: false });
  }
  for (const retirement of segment.retirements ?? []) {
    if (retirement.status !== "dnf") continue;
    const driver = segment.drivers.find(driver => driver.driverNumber === retirement.driverNumber);
    if (!driver) continue;
    milestones.push({ id: `retirement:${retirement.driverNumber}:${retirement.t}`, kind: "retirement",
      time: retirement.t, drivers: [retirement.driverNumber], label: `${driver.acronym} abandona`,
      detail: "Instante estimado a partir de las últimas muestras", approximate: true });
  }
  milestones.push(...offTrackMilestones(segment, laps));
  const unique = new Map(milestones.filter(item => Number.isFinite(item.time) && item.time >= 0 && item.time <= segment.timeRange.end)
    .map(item => [item.id, item]));
  return [...unique.values()].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}
