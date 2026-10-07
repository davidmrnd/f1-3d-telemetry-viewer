export const OPENF1_UNITS_PER_METER = 10;
export const KMH_PER_METER_PER_SECOND = 3.6;
export const MS_PER_SECOND = 1000;

export function openF1UnitsToMeters(units: number): number {
  return units / OPENF1_UNITS_PER_METER;
}

export function metersToOpenF1Units(meters: number): number {
  return meters * OPENF1_UNITS_PER_METER;
}

export function kmhToMetersPerSecond(kmh: number): number {
  return kmh / KMH_PER_METER_PER_SECOND;
}

export function msToSeconds(ms: number): number {
  return ms / MS_PER_SECOND;
}
