// fit-file.js
// Minimal FIT read/write helpers for VeloDrive workouts.
// Focused on the subset of messages we emit: file_id, device_info, session/lap,
// workout/workout_step, records, and developer data for targets + canonical metadata.

const FIT_EPOCH_S = Date.UTC(1989, 11, 31, 0, 0, 0) / 1000;
const MANUFACTURER_VELODRIVE = 255; // development
const PRODUCT_ID_VELODRIVE = 1;
const SPORT_CYCLING = 2;
const DEV_DATA_INDEX = 0;
const CANON_CHUNK_SIZE = 200;
const FIT_TARGET_TYPE_OPEN = 2;
const FIT_TARGET_TYPE_POWER = 4;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const BASE_TYPES = {
  enum: {id: 0x00, size: 1, invalid: 0xff},
  sint8: {id: 0x01, size: 1, invalid: 0x7f},
  uint8: {id: 0x02, size: 1, invalid: 0xff},
  uint8z: {id: 0x0a, size: 1, invalid: 0x00},
  sint16: {id: 0x83, size: 2, invalid: 0x7fff},
  uint16: {id: 0x84, size: 2, invalid: 0xffff},
  uint16z: {id: 0x8b, size: 2, invalid: 0x0000},
  sint32: {id: 0x85, size: 4, invalid: 0x7fffffff},
  uint32: {id: 0x86, size: 4, invalid: 0xffffffff},
  uint32z: {id: 0x8c, size: 4, invalid: 0x00000000},
  float32: {id: 0x88, size: 4, invalid: 0xffffffff},
  string: {id: 0x07, size: 1, invalid: 0x00},
  byte: {id: 0x0d, size: 1, invalid: 0x00},
};

function dateToFitTimestamp(date) {
  if (!date) return 0;
  return Math.floor(date.getTime() / 1000) - FIT_EPOCH_S;
}

function fitTimestampToDate(ts) {
  return new Date((ts + FIT_EPOCH_S) * 1000);
}

function isFreeRideSegment(seg) {
  return Array.isArray(seg) && seg[3] === "freeride";
}

function crc16(bytes) {
  let crc = 0x0000;
  for (let i = 0; i < bytes.length; i++) {
    let b = bytes[i];
    for (let j = 0; j < 8; j++) {
      const mix = (crc ^ b) & 0x01;
      crc >>= 1;
      if (mix) crc ^= 0xa001;
      b >>= 1;
    }
  }
  return crc & 0xffff;
}

function pushUint(bytes, value, size) {
  for (let i = 0; i < size; i++) {
    bytes.push((value >> (8 * i)) & 0xff);
  }
}

function encodeString(str, size) {
  const buf = textEncoder.encode(str || "");
  const out = [];
  const len = Math.min(buf.length, size ? size - 1 : buf.length);
  for (let i = 0; i < len; i++) out.push(buf[i]);
  if (size) {
    out.push(0);
    while (out.length < size) out.push(0);
  } else {
    out.push(0);
  }
  return out;
}

function normalizeBaseType(type) {
  if (typeof type === "string") {
    return BASE_TYPES[type];
  }
  return type;
}

function baseTypeFromId(id) {
  return (
    Object.values(BASE_TYPES).find((t) => t.id === id) || BASE_TYPES.byte
  );
}

function createDefinition(localMsgNum, globalMsgNum, fields, devFields = []) {
  const hasDevFields = devFields.length > 0;
  const bytes = [];
  const header = 0x40 | (hasDevFields ? 0x20 : 0x00) | (localMsgNum & 0x0f);
  bytes.push(header);
  bytes.push(0x00); // reserved
  bytes.push(0x00); // architecture: little endian
  pushUint(bytes, globalMsgNum, 2);
  bytes.push(fields.length);
  fields.forEach((f) => {
    const base = normalizeBaseType(f.type);
    bytes.push(f.num & 0xff);
    bytes.push(f.size || base.size);
    bytes.push(base.id);
  });
  if (hasDevFields) {
    bytes.push(devFields.length);
    devFields.forEach((f) => {
      const base = normalizeBaseType(f.type);
      bytes.push(f.num & 0xff); // field definition number
      bytes.push(f.size || base.size);
      bytes.push(f.devIndex ?? DEV_DATA_INDEX);
    });
  }
  return {localMsgNum, globalMsgNum, fields, devFields, hasDevFields, bytes};
}

function encodeValue(baseType, size, value) {
  const bytes = [];
  const invalid = baseType.invalid;
  const val = value == null ? invalid : value;
  if (Array.isArray(val) || val instanceof Uint8Array) {
    const arr = Array.from(val);
    for (let i = 0; i < (size || arr.length); i++) {
      bytes.push(arr[i] || 0);
    }
    while (bytes.length < (size || baseType.size)) bytes.push(0x00);
    return bytes.slice(0, size || baseType.size);
  }
  switch (baseType.id) {
    case BASE_TYPES.enum.id:
    case BASE_TYPES.uint8.id:
    case BASE_TYPES.uint8z.id:
    case BASE_TYPES.sint8.id:
    case BASE_TYPES.byte.id:
      bytes.push(val & 0xff);
      break;
    case BASE_TYPES.uint16.id:
    case BASE_TYPES.uint16z.id:
    case BASE_TYPES.sint16.id:
      pushUint(bytes, val, 2);
      break;
    case BASE_TYPES.uint32.id:
    case BASE_TYPES.uint32z.id:
    case BASE_TYPES.sint32.id:
    case BASE_TYPES.float32.id:
      pushUint(bytes, val, 4);
      break;
    case BASE_TYPES.string.id: {
      const encoded = encodeString(val || "", size);
      bytes.push(...encoded);
      break;
    }
    default:
      pushUint(bytes, val, size || baseType.size);
      break;
  }
  while (bytes.length < (size || baseType.size)) bytes.push(0x00);
  return bytes.slice(0, size || baseType.size);
}

function createDataMessage(def, fieldValues = {}, devFieldValues = {}) {
  const bytes = [];
  bytes.push(def.localMsgNum & 0x0f);
  def.fields.forEach((f) => {
    const base = normalizeBaseType(f.type);
    const size = f.size || base.size;
    const v = fieldValues[f.num];
    bytes.push(...encodeValue(base, size, v));
  });
  if (def.hasDevFields) {
    def.devFields.forEach((f) => {
      const base = normalizeBaseType(f.type);
      const size = f.size || base.size;
      const key = `${f.devIndex ?? DEV_DATA_INDEX}:${f.num}`;
      const v =
        devFieldValues[f.num] ??
        devFieldValues[key] ??
        devFieldValues[f.name];
      bytes.push(...encodeValue(base, size, v));
    });
  }
  return bytes;
}

function chunkBytes(bytes, chunkSize) {
  const out = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    out.push(bytes.slice(i, i + chunkSize));
  }
  return out;
}

function prepareDeveloperFieldDescriptions() {
  const fields = [
    {
      num: 0,
      name: "vd_tgt_pow",
      type: BASE_TYPES.uint16,
      units: "watts",
      nativeMesgNum: 20, // record
    },
    {
      num: 1,
      name: "vd_start_pct",
      type: BASE_TYPES.uint16,
      units: "0.01pct",
      nativeMesgNum: 27, // workout_step
    },
    {
      num: 2,
      name: "vd_end_pct",
      type: BASE_TYPES.uint16,
      units: "0.01pct",
      nativeMesgNum: 27,
    },
    {
      num: 3,
      name: "vd_source",
      type: BASE_TYPES.string,
      units: "",
      size: 64,
      nativeMesgNum: 26, // workout
    },
    {
      num: 4,
      name: "vd_src_url",
      type: BASE_TYPES.string,
      units: "",
      size: 200,
      nativeMesgNum: 26,
    },
    {
      num: 5,
      name: "vd_desc",
      type: BASE_TYPES.string,
      units: "",
      size: 200,
      nativeMesgNum: 26,
    },
  ];

  return {fields, nextFieldNumber: 10};
}

export function buildFitFile({
  canonicalWorkout,
  samples = [],
  ftp,
  startedAt,
  endedAt,
  pauseEvents = [],
  totalElapsedSec,
}) {
  const bytes = [];

  const cw = canonicalWorkout || {};
  const startDate =
    startedAt instanceof Date
      ? startedAt
      : startedAt
        ? new Date(startedAt)
        : samples.length
          ? new Date(Date.now() - (samples[samples.length - 1].t || 0) * 1000)
          : new Date();
  const computedElapsedMs =
    totalElapsedSec != null
      ? Math.max(0, totalElapsedSec) * 1000
      : samples.length
        ? Math.max(0, samples[samples.length - 1].t || 0) * 1000
        : 0;
  const endDate =
    endedAt instanceof Date
      ? endedAt
      : endedAt
        ? new Date(endedAt)
        : new Date(startDate.getTime() + computedElapsedMs);

  const startTs = dateToFitTimestamp(startDate);
  const endTs = dateToFitTimestamp(endDate);

  const powerVals = samples
    .map((s) => s.power)
    .filter((v) => v != null && Number.isFinite(v));
  const hrVals = samples
    .map((s) => s.hr)
    .filter((v) => v != null && Number.isFinite(v));
  const cadVals = samples
    .map((s) => s.cadence)
    .filter((v) => v != null && Number.isFinite(v));

  const totalWorkJ = samples.reduce((sum, s, idx) => {
    if (s.power == null || !Number.isFinite(s.power)) return sum;
    const prevT = idx > 0 ? samples[idx - 1].t || 0 : 0;
    const dt = Math.max(1, Math.round((s.t || 0) - prevT));
    return sum + s.power * dt;
  }, 0);

  const avg = (arr) =>
    arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

  const max = (arr) => (arr.length ? Math.max(...arr) : null);

  const avgPower = avg(powerVals);
  const avgHr = avg(hrVals);
  const avgCadence = avg(cadVals);
  const maxPower = max(powerVals);
  const maxHr = max(hrVals);
  const maxCadence = max(cadVals);

  const durationSec = samples.length ? samples[samples.length - 1].t || 0 : 0;
  const totalElapsedTimeMs =
    totalElapsedSec != null
      ? Math.max(0, Math.round(totalElapsedSec * 1000))
      : Math.max(0, endDate.getTime() - startDate.getTime());
  const totalTimerTimeMs = Math.max(0, Math.round(durationSec * 1000));

  const devInfo = prepareDeveloperFieldDescriptions();
  const canonicalBytes = textEncoder.encode(JSON.stringify(cw));
  const canonicalChunks = chunkBytes(canonicalBytes, CANON_CHUNK_SIZE);

  canonicalChunks.forEach((chunk, idx) => {
    devInfo.fields.push({
      num: devInfo.nextFieldNumber + idx,
      name: `vd_canon${idx}`,
      type: BASE_TYPES.byte,
      units: "",
      nativeMesgNum: 26,
      size: chunk.length,
    });
  });

  const developerDataIdDef = createDefinition(2, 207, [
    {num: 0, type: "uint8"}, // developer_data_index
    {num: 1, type: "byte", size: 16}, // application_id
    {num: 2, type: "uint32"}, // application_version
  ]);

  const fieldDescriptionDef = createDefinition(3, 206, [
    {num: 0, type: "uint8"}, // developer_data_index
    {num: 1, type: "uint8"}, // field_definition_number
    {num: 2, type: "uint8"}, // fit_base_type_id
    {num: 3, type: "string", size: 16}, // field_name
    {num: 4, type: "string", size: 16}, // units
    {num: 5, type: "uint16"}, // native_mesg_num
    {num: 6, type: "uint8"}, // native_field_num
  ]);

  const fileIdDef = createDefinition(0, 0, [
    {num: 0, type: "enum"}, // type
    {num: 1, type: "uint16"}, // manufacturer
    {num: 2, type: "uint16"}, // product
    {num: 3, type: "uint32"}, // serial_number
    {num: 4, type: "uint32"}, // time_created
    {num: 8, type: "string", size: 20}, // product_name
  ]);

  const deviceInfoDef = createDefinition(1, 23, [
    {num: 0, type: "uint8"}, // device_index
    {num: 1, type: "uint32"}, // device_type? we skip
    {num: 2, type: "uint16"}, // manufacturer
    {num: 4, type: "uint16"}, // product
    {num: 5, type: "uint16"}, // software_version
    {num: 3, type: "uint32"}, // serial_number
    {num: 7, type: "string", size: 20}, // product_name
    {num: 253, type: "uint32"}, // timestamp
  ]);

  const workoutDevFields = [];
  devInfo.fields
    .filter((f) => f.nativeMesgNum === 26)
    .forEach((f) => {
      workoutDevFields.push({
        num: f.num,
        size: f.size || (f.type ? normalizeBaseType(f.type).size : 1),
        type: f.type || BASE_TYPES.byte,
        devIndex: DEV_DATA_INDEX,
      });
    });

  const workoutDef = createDefinition(
    4,
    26,
    [
      {num: 0, type: "string", size: 50}, // wkt_name
      {num: 4, type: "enum"}, // sport
      {num: 5, type: "uint32"}, // capabilities
      {num: 6, type: "uint16"}, // num_valid_steps
    ],
    workoutDevFields
  );

  const workoutStepDevFields = [
    {num: 1, type: "uint16", devIndex: DEV_DATA_INDEX},
    {num: 2, type: "uint16", devIndex: DEV_DATA_INDEX},
  ];

  const workoutStepDef = createDefinition(
    5,
    27,
    [
      {num: 254, type: "uint16"}, // message_index
      {num: 0, type: "string", size: 20}, // wkt_step_name
      {num: 1, type: "enum"}, // duration_type
      {num: 2, type: "uint32"}, // duration_value
      {num: 3, type: "enum"}, // target_type
      {num: 4, type: "uint32"}, // target_value
      {num: 5, type: "uint32"}, // custom_target_value_low
      {num: 6, type: "uint32"}, // custom_target_value_high
      {num: 7, type: "enum"}, // intensity
    ],
    workoutStepDevFields
  );

  const recordDevFields = [
    {num: 0, type: "uint16", devIndex: DEV_DATA_INDEX},
  ];

  const recordDef = createDefinition(
    6,
    20,
    [
      {num: 253, type: "uint32"},
      {num: 3, type: "uint8"}, // heart_rate
      {num: 4, type: "uint8"}, // cadence
      {num: 7, type: "uint16"}, // power
    ],
    recordDevFields
  );

  const sessionDef = createDefinition(7, 18, [
    {num: 253, type: "uint32"}, // timestamp (end)
    {num: 2, type: "uint32"}, // start_time
    {num: 5, type: "enum"}, // sport
    {num: 6, type: "enum"}, // sub_sport
    {num: 7, type: "uint32"}, // total_elapsed_time
    {num: 8, type: "uint32"}, // total_timer_time
    {num: 9, type: "uint32"}, // total_distance
    {num: 11, type: "uint8"}, // avg_cadence
    {num: 12, type: "uint8"}, // max_cadence
    {num: 13, type: "uint16"}, // total_calories
    {num: 20, type: "uint16"}, // avg_power
    {num: 21, type: "uint16"}, // max_power
    {num: 41, type: "uint32"}, // total_work
    {num: 57, type: "uint16"}, // threshold_power
    {num: 17, type: "uint16"}, // first_lap_index
    {num: 18, type: "uint16"}, // num_laps
  ]);

  const lapDef = createDefinition(8, 19, [
    {num: 253, type: "uint32"}, // timestamp
    {num: 2, type: "uint32"}, // start_time
    {num: 5, type: "enum"}, // sport
    {num: 6, type: "enum"}, // sub_sport
    {num: 7, type: "uint32"}, // total_elapsed_time
    {num: 8, type: "uint32"}, // total_timer_time
    {num: 11, type: "uint8"}, // avg_cadence
    {num: 12, type: "uint8"}, // max_cadence
    {num: 13, type: "uint16"}, // total_calories
    {num: 20, type: "uint16"}, // avg_power
    {num: 21, type: "uint16"}, // max_power
    {num: 41, type: "uint32"}, // total_work
    {num: 57, type: "uint16"}, // threshold_power
  ]);

  const eventDef = createDefinition(9, 21, [
    {num: 253, type: "uint32"}, // timestamp
    {num: 0, type: "enum"}, // event
    {num: 1, type: "enum"}, // event_type
  ]);

  const defs = [
    developerDataIdDef,
    fieldDescriptionDef,
    fileIdDef,
    deviceInfoDef,
    workoutDef,
    workoutStepDef,
    recordDef,
    sessionDef,
    lapDef,
    eventDef,
  ];

  defs.forEach((d) => bytes.push(...d.bytes));

  // developer_data_id
  const appId = encodeString("VeloDrive", 16);
  bytes.push(
    ...createDataMessage(developerDataIdDef, {
      0: DEV_DATA_INDEX,
      1: appId,
      2: 1,
    })
  );

  // field_descriptions
  devInfo.fields.forEach((f) => {
    bytes.push(
      ...createDataMessage(fieldDescriptionDef, {
        0: DEV_DATA_INDEX,
        1: f.num,
        2: normalizeBaseType(f.type).id,
        3: f.name,
        4: f.units || "",
        5: f.nativeMesgNum || 0xffff,
        6: f.nativeFieldNum || 0xff,
      })
    );
  });

  // file_id
  bytes.push(
    ...createDataMessage(fileIdDef, {
      0: 4, // activity
      1: MANUFACTURER_VELODRIVE,
      2: PRODUCT_ID_VELODRIVE,
      3: 0,
      4: startTs,
      8: "VeloDrive",
    })
  );

  // device_info
  bytes.push(
    ...createDataMessage(deviceInfoDef, {
      0: 0,
      1: 0,
      2: MANUFACTURER_VELODRIVE,
      3: 0,
      4: PRODUCT_ID_VELODRIVE,
      5: 1,
      7: "VeloDrive",
      253: startTs,
    })
  );

  // workout
  const workoutDevValues = {};
  devInfo.fields.forEach((f) => {
    if (f.name === "vd_source") workoutDevValues[f.num] = cw.source || "";
    if (f.name === "vd_src_url") workoutDevValues[f.num] = cw.sourceURL || "";
    if (f.name === "vd_desc") workoutDevValues[f.num] = cw.description || "";
    if (f.name.startsWith("vd_canon")) {
      const idx = Number(f.name.replace("vd_canon", "")) || 0;
      const chunk = canonicalChunks[idx] || [];
      workoutDevValues[f.num] = chunk;
    }
  });

  bytes.push(
    ...createDataMessage(
      workoutDef,
      {
        0: cw.workoutTitle || "Workout",
        4: SPORT_CYCLING,
        5: 0,
        6: cw.rawSegments ? cw.rawSegments.length : 0,
      },
      workoutDevValues
    )
  );

  // workout_steps
  (cw.rawSegments || []).forEach((seg, idx) => {
    const [minutes, startPct, endPct] = seg;
    const durationSec = Math.max(1, Math.round((minutes || 0) * 60));
    const isFreeRide = isFreeRideSegment(seg);
    const ftpVal = ftp || 0;
    const startPctVal = isFreeRide ? 50 : startPct || 0;
    const endPctVal = isFreeRide ? 50 : (endPct != null ? endPct : startPct || 0);
    const startW = Math.round((startPctVal / 100) * ftpVal);
    const endW = Math.round((endPctVal / 100) * ftpVal);

    bytes.push(
      ...createDataMessage(
        workoutStepDef,
        {
          254: idx,
          0: `Step ${idx + 1}`,
          1: 0, // duration_time
          2: durationSec * 1000, // milliseconds
          3: isFreeRide ? FIT_TARGET_TYPE_OPEN : FIT_TARGET_TYPE_POWER,
          4: 0xffffffff, // invalid target_value
          5: isFreeRide ? null : startW,
          6: isFreeRide ? null : endW,
          7: 2, // intensity: interval
        },
        isFreeRide
          ? {}
          : {
              1: Math.round(startPctVal * 100),
              2: Math.round(endPctVal * 100),
            }
      )
    );
  });

  // records
  samples.forEach((s) => {
    const ts = startTs + Math.round(s.t || 0);
    bytes.push(
      ...createDataMessage(
        recordDef,
        {
          253: ts,
          3: s.hr,
          4: s.cadence,
          7: s.power,
        },
        {
          0: s.targetPower != null ? Math.round(s.targetPower) : null,
        }
      )
    );
  });

  // timer stop/start events for pauses
  const timerEvents = [];
  const normalizedPauses = Array.isArray(pauseEvents) ? pauseEvents : [];
  normalizedPauses
    .map((ev) => {
      const at = ev?.at ? new Date(ev.at) : null;
      if (!at || Number.isNaN(at.getTime())) return null;
      const type =
        ev.type === "start"
          ? "start"
          : ev.type === "stop_all"
            ? "stop_all"
            : "stop";
      return {type, ts: dateToFitTimestamp(at)};
    })
    .filter(Boolean)
    .forEach((ev) => timerEvents.push(ev));
  if (!timerEvents.some((ev) => ev.type === "start")) {
    timerEvents.push({type: "start", ts: startTs});
  }
  if (!timerEvents.some((ev) => ev.type === "stop_all")) {
    timerEvents.push({type: "stop_all", ts: endTs});
  }
  timerEvents
    .sort((a, b) => a.ts - b.ts)
    .forEach((ev) => {
      const eventType =
        ev.type === "start" ? 0 : ev.type === "stop_all" ? 2 : 1;
      bytes.push(
        ...createDataMessage(eventDef, {
          253: ev.ts,
          0: 0, // timer
          1: eventType,
        })
      );
    });

  // session
  bytes.push(
    ...createDataMessage(sessionDef, {
      253: endTs,
      2: startTs,
      5: SPORT_CYCLING,
      6: 0,
      7: totalElapsedTimeMs,
      8: totalTimerTimeMs,
      9: 0xffffffff,
      11: avgCadence,
      12: maxCadence,
      13: 0xffff, // calories unknown
      20: avgPower,
      21: maxPower,
      41: Math.round(totalWorkJ),
      57: ftp != null ? ftp : null,
      17: 0,
      18: 1,
    })
  );

  // lap (single lap spanning session)
  bytes.push(
    ...createDataMessage(lapDef, {
      253: endTs,
      2: startTs,
      5: SPORT_CYCLING,
      6: 0,
      7: totalElapsedTimeMs,
      8: totalTimerTimeMs,
      11: avgCadence,
      12: maxCadence,
      13: 0xffff,
      20: avgPower,
      21: maxPower,
      41: Math.round(totalWorkJ),
      57: ftp != null ? ftp : null,
    })
  );

  const headerSize = 14;
  const dataSize = bytes.length;
  const header = [];
  header.push(headerSize);
  header.push(0x20); // protocol version 2.0
  pushUint(header, 0x0100, 2); // profile version
  pushUint(header, dataSize, 4);
  header.push(0x2e, 0x46, 0x49, 0x54); // ".FIT"
  const headerCrc = crc16(header);
  pushUint(header, headerCrc, 2);

  const fileBytes = new Uint8Array(headerSize + dataSize + 2);
  fileBytes.set(header, 0);
  fileBytes.set(bytes, headerSize);
  const fileCrc = crc16([...header, ...bytes]);
  fileBytes[headerSize + dataSize] = fileCrc & 0xff;
  fileBytes[headerSize + dataSize + 1] = (fileCrc >> 8) & 0xff;

  return fileBytes;
}

function readValue(baseType, size, dataView, offset) {
  const invalid = baseType.invalid;
  let value = null;
  switch (baseType.id) {
    case BASE_TYPES.byte.id: {
      if (size > 1) {
        const bytes = [];
        for (let i = 0; i < size; i++) {
          bytes.push(dataView.getUint8(offset + i));
        }
        value = new Uint8Array(bytes);
      } else {
        value = dataView.getUint8(offset);
      }
      break;
    }
    case BASE_TYPES.enum.id:
    case BASE_TYPES.uint8.id:
    case BASE_TYPES.uint8z.id:
    case BASE_TYPES.sint8.id:
      value = dataView.getUint8(offset);
      break;
    case BASE_TYPES.uint16.id:
    case BASE_TYPES.uint16z.id:
      value = dataView.getUint16(offset, true);
      break;
    case BASE_TYPES.sint16.id:
      value = dataView.getInt16(offset, true);
      break;
    case BASE_TYPES.uint32.id:
    case BASE_TYPES.uint32z.id:
      value = dataView.getUint32(offset, true);
      break;
    case BASE_TYPES.sint32.id:
      value = dataView.getInt32(offset, true);
      break;
    case BASE_TYPES.string.id: {
      const bytes = [];
      for (let i = 0; i < size; i++) {
        const b = dataView.getUint8(offset + i);
        if (b === 0) break;
        bytes.push(b);
      }
      value = textDecoder.decode(new Uint8Array(bytes));
      break;
    }
    case BASE_TYPES.float32.id:
      value = dataView.getFloat32(offset, true);
      break;
    default: {
      const bytes = [];
      for (let i = 0; i < size; i++) {
        bytes.push(dataView.getUint8(offset + i));
      }
      value = bytes;
      break;
    }
  }
  if (value === invalid) return null;
  return value;
}

function parseHeader(dataView) {
  const headerSize = dataView.getUint8(0);
  const dataSize = dataView.getUint32(4, true);
  return {headerSize, dataSize};
}

function parseDefinition(dataView, offset, hasDevFields, localMsgNum) {
  const arch = dataView.getUint8(offset + 1);
  const little = arch === 0;
  const globalMsgNum = dataView.getUint16(offset + 2, little);
  const numFields = dataView.getUint8(offset + 4);
  const fields = [];
  let cursor = offset + 5;
  for (let i = 0; i < numFields; i++) {
    const num = dataView.getUint8(cursor++);
    const size = dataView.getUint8(cursor++);
    const baseTypeId = dataView.getUint8(cursor++);
    const baseType =
      Object.values(BASE_TYPES).find((t) => t.id === baseTypeId) ||
      BASE_TYPES.byte;
    fields.push({num, size, type: baseType});
  }
  const devFields = [];
  if (hasDevFields) {
    const devCount = dataView.getUint8(cursor++);
    for (let i = 0; i < devCount; i++) {
      const num = dataView.getUint8(cursor++);
      const size = dataView.getUint8(cursor++);
      const devIndex = dataView.getUint8(cursor++);
      devFields.push({num, size, devIndex});
    }
  }
  const totalSize =
    5 + numFields * 3 + (hasDevFields ? 1 + devFields.length * 3 : 0);
  return {
    nextOffset: offset + totalSize,
    def: {localMsgNum, globalMsgNum, fields, devFields, hasDevFields},
  };
}

export function parseFitFile(arrayBuffer) {
  const dataView = new DataView(arrayBuffer);
  const {headerSize, dataSize} = parseHeader(dataView);
  const defs = new Map();
  const devFieldInfo = new Map();
  const recordSamples = [];
  const workoutSteps = [];
  const workoutMeta = {};
  const workoutDevFieldValues = {};
  const sessionValues = {};
  const timerEvents = [];

  const limit = headerSize + dataSize;
  let offset = headerSize;
  while (offset < limit) {
    const header = dataView.getUint8(offset++);
    const isDefinition = (header & 0x40) !== 0;
    const hasDevFields = (header & 0x20) !== 0;
    const localMsgNum = header & 0x0f;

    if (isDefinition) {
      const {def, nextOffset} = parseDefinition(
        dataView,
        offset,
        hasDevFields,
        localMsgNum
      );
      defs.set(localMsgNum, def);
      offset = nextOffset;
      continue;
    }

    const def = defs.get(localMsgNum);
    if (!def) break;

    const values = {};
    let cursor = offset;
    def.fields.forEach((f) => {
      const base = f.type || BASE_TYPES.byte;
      values[f.num] = readValue(base, f.size, dataView, cursor);
      cursor += f.size;
    });

    const devValues = {};
    if (def.hasDevFields) {
      def.devFields.forEach((f) => {
        const info = devFieldInfo.get(`${f.devIndex}:${f.num}`);
        const base = info
          ? baseTypeFromId(info.fitBaseTypeId)
          : BASE_TYPES.byte;
        const val = readValue(base, f.size, dataView, cursor);
        cursor += f.size;
        const key = `${f.devIndex}:${f.num}`;
        devValues[key] = val;
      });
    }

    offset = cursor;

    switch (def.globalMsgNum) {
      case 206: {
        const name = values[3] || "";
        const devIndex = values[0] || 0;
        const fieldNum = values[1] || 0;
        const fitBaseTypeId = values[2];
        const nativeMesgNum = values[5];
        const nativeFieldNum = values[6];
        devFieldInfo.set(`${devIndex}:${fieldNum}`, {
          name,
          fitBaseTypeId,
          nativeMesgNum,
          nativeFieldNum,
        });
        break;
      }
      case 207:
        // developer_data_id; no-op
        break;
      case 20: {
        const ts = values[253];
        if (ts == null) break;
        const sample = {
          t: ts,
          power: values[7],
          hr: values[3],
          cadence: values[4],
          targetPower: null,
        };
        const tgtKey = `${DEV_DATA_INDEX}:0`;
        if (devValues[tgtKey] != null) {
          const raw = devValues[tgtKey];
          sample.targetPower = Array.isArray(raw) ? null : raw;
        }
        recordSamples.push(sample);
        break;
      }
      case 27: {
        const msgIdx = values[254] || 0;
        const durMs = values[2] || 0;
        const targetType = values[3];
        const startPct =
          devValues[`${DEV_DATA_INDEX}:1`] != null
            ? devValues[`${DEV_DATA_INDEX}:1`] / 100
            : null;
        const endPct =
          devValues[`${DEV_DATA_INDEX}:2`] != null
            ? devValues[`${DEV_DATA_INDEX}:2`] / 100
            : null;
        workoutSteps[msgIdx] = {
          durationSec: durMs / 1000,
          startPct,
          endPct,
          customLow: values[5],
          customHigh: values[6],
          targetType,
        };
        break;
      }
      case 26: {
        workoutMeta.name = values[0] || workoutMeta.name;
        def.devFields.forEach((f) => {
          const info = devFieldInfo.get(`${f.devIndex}:${f.num}`);
          if (!info) return;
          const val = devValues[`${f.devIndex}:${f.num}`];
          workoutDevFieldValues[info.name] = val;
        });
        break;
      }
      case 18: {
        Object.assign(sessionValues, values);
        break;
      }
      case 21: {
        // timer event
        const ts = values[253];
        const type = values[1];
        if (ts != null && type != null) {
          timerEvents.push({ts, type});
        }
        break;
      }
      default:
        break;
    }
  }

  let startTime = null;
  if (sessionValues[2] != null) {
    startTime = fitTimestampToDate(sessionValues[2]);
  } else if (recordSamples.length) {
    startTime = fitTimestampToDate(recordSamples[0].t);
  }

  const samples = recordSamples.map((s) => {
    const relT = startTime ? s.t - dateToFitTimestamp(startTime) : 0;
    return {
      t: relT,
      power: s.power,
      hr: s.hr,
      cadence: s.cadence,
      targetPower: s.targetPower,
    };
  });

  let canonicalWorkout = null;
  const canonChunks = Object.keys(workoutDevFieldValues)
    .filter((k) => k.startsWith("vd_canon"))
    .sort((a, b) => {
      const ai = Number(a.replace("vd_canon", ""));
      const bi = Number(b.replace("vd_canon", ""));
      return ai - bi;
    })
    .map((k) => workoutDevFieldValues[k])
    .filter(Boolean);

  if (canonChunks.length) {
    const merged = new Uint8Array(
      canonChunks.reduce((sum, chunk) => sum + chunk.length, 0)
    );
    let pos = 0;
    canonChunks.forEach((chunk) => {
      merged.set(chunk, pos);
      pos += chunk.length;
    });
    try {
      let trimmed = merged;
      while (trimmed.length && trimmed[trimmed.length - 1] === 0) {
        trimmed = trimmed.slice(0, -1);
      }
      canonicalWorkout = JSON.parse(textDecoder.decode(trimmed));
    } catch (err) {
      canonicalWorkout = null;
    }
  }

  if (!canonicalWorkout) {
    const ftp = sessionValues[57] || 0;
    const rawSegments = [];
    workoutSteps.forEach((s) => {
      if (!s) return;
      const minutes = (s.durationSec || 0) / 60;
      const isFreeRide = s.targetType === FIT_TARGET_TYPE_OPEN;
      if (isFreeRide) {
        rawSegments.push([minutes, 50, 50, "freeride"]);
        return;
      }
      const ftpSafe = ftp || 1;
      const startPct =
        s.startPct != null ? s.startPct : ((s.customLow || 0) / ftpSafe) * 100;
      const endPct =
        s.endPct != null
          ? s.endPct
          : ((s.customHigh != null ? s.customHigh : s.customLow || 0) /
              ftpSafe) *
            100;
      rawSegments.push([minutes, startPct, endPct]);
    });

    canonicalWorkout = {
      source: workoutDevFieldValues["vd_source"] || "Unknown",
      sourceURL: workoutDevFieldValues["vd_src_url"] || "",
      workoutTitle: workoutMeta.name || "Workout",
      rawSegments,
      description: workoutDevFieldValues["vd_desc"] || "",
    };
  }

  const meta = {
    ftp: sessionValues[57] || null,
    startedAt: startTime,
    endedAt:
      sessionValues[253] != null
        ? fitTimestampToDate(sessionValues[253])
        : recordSamples.length
        ? fitTimestampToDate(recordSamples[recordSamples.length - 1].t)
        : null,
    totalWorkJ: sessionValues[41] || null,
    totalElapsedSec:
      sessionValues[7] != null ? sessionValues[7] / 1000 : null,
    totalTimerSec: sessionValues[8] != null ? sessionValues[8] / 1000 : null,
    pauseEvents: timerEvents.map((ev) => ({
      type: ev.type === 0 ? "start" : ev.type === 2 ? "stop_all" : "stop",
      at: fitTimestampToDate(ev.ts),
    })),
  };

  return {canonicalWorkout, samples, meta};
}
