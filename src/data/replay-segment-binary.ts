import type { CarSample, ReplaySegment } from "../types";

const MAGIC = 0x53523146;
const VERSION = 1;
const NULL_SENTINEL_I16 = -1;
const NULL_COMPOUND = 255;

function align(offset: number, size: number): number {
  const mask = size - 1;
  return (offset + mask) & ~mask;
}

export function decodeReplaySegmentBinary(buffer: ArrayBuffer | Uint8Array): ReplaySegment {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || view.getUint32(0, true) !== MAGIC) {
    throw new Error("Cabecera binaria de replay inválida.");
  }
  const version = view.getUint16(4, true);
  if (version !== VERSION) {
    throw new Error(`Versión binaria no soportada: ${version}`);
  }
  const metaLength = view.getUint32(8, true);
  const metaStart = 12;
  const metaEnd = metaStart + metaLength;
  if (metaEnd > bytes.byteLength) {
    throw new Error("Metadatos binarios truncados.");
  }
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(metaStart, metaEnd))) as Omit<
    ReplaySegment,
    "samples"
  > &
    Record<string, unknown>;

  let cursor = align(metaEnd, 8);
  const compoundCount = view.getUint16(cursor, true);
  cursor += 2;
  const compounds: string[] = [];
  for (let index = 0; index < compoundCount; index += 1) {
    const length = view.getUint16(cursor, true);
    cursor += 2;
    compounds.push(new TextDecoder().decode(bytes.subarray(cursor, cursor + length)));
    cursor += length;
  }

  cursor = align(cursor, 8);
  const driverCount = view.getUint32(cursor, true);
  cursor += 4;
  const samples: Record<number, CarSample[]> = {};

  for (let driverIndex = 0; driverIndex < driverCount; driverIndex += 1) {
    cursor = align(cursor, 8);
    const driverNumber = view.getUint16(cursor, true);
    const count = view.getUint32(cursor + 4, true);
    cursor += 8;

    cursor = align(cursor, 8);
    const times = new Float64Array(count);
    for (let index = 0; index < count; index += 1) {
      times[index] = view.getFloat64(cursor + index * 8, true);
    }
    cursor += count * 8;

    const readF32Column = (): Float32Array => {
      cursor = align(cursor, 4);
      const column = new Float32Array(count);
      for (let index = 0; index < count; index += 1) {
        column[index] = view.getFloat32(cursor + index * 4, true);
      }
      cursor += count * 4;
      return column;
    };

    const xs = readF32Column();
    const ys = readF32Column();
    const zs = readF32Column();
    const speeds = readF32Column();
    const throttles = readF32Column();
    const brakes = readF32Column();
    const rpms = readF32Column();

    cursor = align(cursor, 1);
    const gears = new Int8Array(count);
    for (let index = 0; index < count; index += 1) {
      gears[index] = view.getInt8(cursor + index);
    }
    cursor += count;
    const drsValues = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) {
      drsValues[index] = view.getUint8(cursor + index);
    }
    cursor += count;

    cursor = align(cursor, 2);
    const positions = new Int16Array(count);
    for (let index = 0; index < count; index += 1) {
      positions[index] = view.getInt16(cursor + index * 2, true);
    }
    cursor += count * 2;

    const gaps = readF32Column();
    const intervals = readF32Column();

    cursor = align(cursor, 1);
    const compoundIndexes = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) {
      compoundIndexes[index] = view.getUint8(cursor + index);
    }
    cursor += count;

    cursor = align(cursor, 2);
    const tyreAges = new Int16Array(count);
    for (let index = 0; index < count; index += 1) {
      tyreAges[index] = view.getInt16(cursor + index * 2, true);
    }
    cursor += count * 2;

    const series: CarSample[] = new Array(count);
    for (let index = 0; index < count; index += 1) {
      const compoundIndex = compoundIndexes[index];
      const position = positions[index];
      const tyreAge = tyreAges[index];
      const gap = gaps[index];
      const interval = intervals[index];
      series[index] = {
        t: times[index],
        isoTime: "",
        driverNumber,
        x: xs[index],
        y: ys[index],
        z: zs[index],
        speed: speeds[index],
        throttle: throttles[index],
        brake: brakes[index],
        rpm: rpms[index],
        gear: gears[index],
        drs: drsValues[index],
        position: position === NULL_SENTINEL_I16 ? null : position,
        gapToLeader: Number.isNaN(gap) ? null : gap,
        intervalToAhead: Number.isNaN(interval) ? null : interval,
        compound: compoundIndex === NULL_COMPOUND ? null : compounds[compoundIndex] ?? null,
        tyreAge: tyreAge === NULL_SENTINEL_I16 ? null : tyreAge,
      };
    }
    samples[driverNumber] = series;
  }

  return {
    ...(meta as Omit<ReplaySegment, "samples">),
    samples,
    raceControl: meta.raceControl ?? [],
    startingGrid: meta.startingGrid ?? [],
    trackStatus: meta.trackStatus ?? [],
  };
}
