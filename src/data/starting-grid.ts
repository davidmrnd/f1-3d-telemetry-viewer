import type { ReplaySegment, StartingGridSlot } from "../types";

const GRID_SAMPLE_MAX_AGE_MS = 5000;

function uncontestedSlots(slots: StartingGridSlot[]): StartingGridSlot[] {
  const drivers = new Map<number, number>();
  const positions = new Map<number, number>();
  for (const { driverNumber, position } of slots) {
    drivers.set(driverNumber, (drivers.get(driverNumber) ?? 0) + 1);
    positions.set(position, (positions.get(position) ?? 0) + 1);
  }
  return slots.filter(({ driverNumber, position }) => drivers.get(driverNumber) === 1 && positions.get(position) === 1);
}

export function resolveStartingGrid(segment: ReplaySegment): StartingGridSlot[] {
  const valid = (segment.startingGrid ?? []).filter(({ driverNumber, position }) =>
    Number.isInteger(driverNumber) && driverNumber > 0 && Number.isInteger(position) && position > 0);
  const slots = [...new Map(valid.map(slot => [`${slot.driverNumber}:${slot.position}`, slot])).values()];
  const uncontested = uncontestedSlots(slots);
  if (uncontested.length === slots.length) return slots;

  const start = segment.trackStatus?.find(interval => interval.phase === "standing_start")?.start;
  if (start === undefined) return uncontested;

  const observed = new Map<number, number>();
  for (const driverNumber of new Set(slots.map(slot => slot.driverNumber))) {
    const samples = segment.samples[driverNumber] ?? [];
    const firstAfter = samples.findIndex(sample => sample.t > start);
    const sample = firstAfter < 0 ? samples.at(-1) : samples[firstAfter - 1];
    if (sample?.position != null && sample.t >= start - GRID_SAMPLE_MAX_AGE_MS) {
      observed.set(driverNumber, sample.position);
    }
  }

  const confirmed = uncontestedSlots(slots.filter(slot => observed.get(slot.driverNumber) === slot.position));
  const assignedDrivers = new Set(confirmed.map(slot => slot.driverNumber));
  const assignedPositions = new Set(confirmed.map(slot => slot.position));
  const remaining = slots.filter(slot => !assignedDrivers.has(slot.driverNumber) && !assignedPositions.has(slot.position));
  return [...confirmed, ...uncontestedSlots(remaining)].sort((a, b) => a.position - b.position);
}
