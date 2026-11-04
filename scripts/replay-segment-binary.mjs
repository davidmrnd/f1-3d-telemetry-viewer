const MAGIC = 0x53523146;
const VERSION = 1;
const NULL_SENTINEL_I16 = -1;
const NULL_COMPOUND = 255;

function align(offset, size) {
  const mask = size - 1;
  return (offset + mask) & ~mask;
}

function collectCompounds(samples) {
  const compounds = [];
  const indexByName = new Map();
  for (const series of Object.values(samples ?? {})) {
    for (const sample of series) {
      const name = sample.compound;
      if (name == null || name === "") {
        continue;
      }
      if (!indexByName.has(name)) {
        indexByName.set(name, compounds.length);
        compounds.push(name);
      }
    }
  }
  if (compounds.length > NULL_COMPOUND) {
    throw new Error(`Demasiados compounds distintos (${compounds.length}); máximo ${NULL_COMPOUND}.`);
  }
  return { compounds, indexByName };
}

function measureDriverBlock(sampleCount) {
  let size = 8;
  size = align(size, 8) + sampleCount * 8;
  size = align(size, 4) + sampleCount * 4 * 7;
  size = align(size, 1) + sampleCount * 2;
  size = align(size, 2) + sampleCount * 2;
  size = align(size, 4) + sampleCount * 4 * 2;
  size = align(size, 1) + sampleCount;
  size = align(size, 2) + sampleCount * 2;
  return size;
}

export function encodeReplaySegmentBinary(segment) {
  const samples = segment.samples ?? {};
  const { compounds, indexByName } = collectCompounds(samples);
  const meta = { ...segment };
  delete meta.samples;
  const metaBytes = Buffer.from(JSON.stringify(meta), "utf8");
  const driverNumbers = Object.keys(samples)
    .map(Number)
    .sort((a, b) => a - b);

  let compoundsBytes = 2;
  const compoundEncoded = compounds.map((name) => {
    const bytes = Buffer.from(name, "utf8");
    compoundsBytes += 2 + bytes.length;
    return bytes;
  });

  let offset = 12;
  offset += metaBytes.length;
  offset = align(offset, 8);
  const compoundsAt = offset;
  offset += compoundsBytes;
  offset = align(offset, 8);
  const driversAt = offset;
  offset += 4;
  for (const driverNumber of driverNumbers) {
    const count = samples[driverNumber]?.length ?? 0;
    offset = align(offset, 8);
    offset += measureDriverBlock(count);
  }

  const buffer = new ArrayBuffer(offset);
  const view = new DataView(buffer);
  const out = new Uint8Array(buffer);

  view.setUint32(0, MAGIC, true);
  view.setUint16(4, VERSION, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, metaBytes.length, true);
  out.set(metaBytes, 12);

  let cursor = compoundsAt;
  view.setUint16(cursor, compounds.length, true);
  cursor += 2;
  for (const bytes of compoundEncoded) {
    view.setUint16(cursor, bytes.length, true);
    cursor += 2;
    out.set(bytes, cursor);
    cursor += bytes.length;
  }

  cursor = driversAt;
  view.setUint32(cursor, driverNumbers.length, true);
  cursor += 4;

  for (const driverNumber of driverNumbers) {
    const series = samples[driverNumber] ?? [];
    const count = series.length;
    cursor = align(cursor, 8);
    view.setUint16(cursor, driverNumber, true);
    view.setUint16(cursor + 2, 0, true);
    view.setUint32(cursor + 4, count, true);
    cursor += 8;

    cursor = align(cursor, 8);
    for (let index = 0; index < count; index += 1) {
      view.setFloat64(cursor + index * 8, series[index].t, true);
    }
    cursor += count * 8;

    const writeF32Column = (read) => {
      cursor = align(cursor, 4);
      for (let index = 0; index < count; index += 1) {
        view.setFloat32(cursor + index * 4, read(series[index]), true);
      }
      cursor += count * 4;
    };

    writeF32Column((sample) => sample.x);
    writeF32Column((sample) => sample.y);
    writeF32Column((sample) => sample.z);
    writeF32Column((sample) => sample.speed);
    writeF32Column((sample) => sample.throttle);
    writeF32Column((sample) => sample.brake);
    writeF32Column((sample) => sample.rpm);

    cursor = align(cursor, 1);
    for (let index = 0; index < count; index += 1) {
      view.setInt8(cursor + index, series[index].gear ?? 0);
    }
    cursor += count;
    for (let index = 0; index < count; index += 1) {
      view.setUint8(cursor + index, series[index].drs ?? 0);
    }
    cursor += count;

    cursor = align(cursor, 2);
    for (let index = 0; index < count; index += 1) {
      const value = series[index].position;
      view.setInt16(cursor + index * 2, value == null ? NULL_SENTINEL_I16 : value, true);
    }
    cursor += count * 2;

    writeF32Column((sample) => (sample.gapToLeader == null ? Number.NaN : sample.gapToLeader));
    writeF32Column((sample) => (sample.intervalToAhead == null ? Number.NaN : sample.intervalToAhead));

    cursor = align(cursor, 1);
    for (let index = 0; index < count; index += 1) {
      const name = series[index].compound;
      const compoundIndex = name == null || name === "" ? NULL_COMPOUND : indexByName.get(name);
      view.setUint8(cursor + index, compoundIndex ?? NULL_COMPOUND);
    }
    cursor += count;

    cursor = align(cursor, 2);
    for (let index = 0; index < count; index += 1) {
      const value = series[index].tyreAge;
      view.setInt16(cursor + index * 2, value == null ? NULL_SENTINEL_I16 : value, true);
    }
    cursor += count * 2;
  }

  return Buffer.from(buffer, 0, cursor);
}

export function decodeReplaySegmentBinary(buffer) {
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
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(metaStart, metaEnd)));

  let cursor = align(metaEnd, 8);
  const compoundCount = view.getUint16(cursor, true);
  cursor += 2;
  const compounds = [];
  for (let index = 0; index < compoundCount; index += 1) {
    const length = view.getUint16(cursor, true);
    cursor += 2;
    compounds.push(new TextDecoder().decode(bytes.subarray(cursor, cursor + length)));
    cursor += length;
  }

  cursor = align(cursor, 8);
  const driverCount = view.getUint32(cursor, true);
  cursor += 4;
  const samples = {};

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

    const readF32Column = () => {
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

    const series = new Array(count);
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
    ...meta,
    samples,
    raceControl: meta.raceControl ?? [],
    startingGrid: meta.startingGrid ?? [],
    trackStatus: meta.trackStatus ?? [],
  };
}
