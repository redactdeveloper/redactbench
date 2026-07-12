export function parseCheckpoint(raw) {
  if (raw === null || raw === "") {
    return 0;
  }

  if (typeof raw !== "string") {
    throw new TypeError("checkpoint must be a string or null");
  }

  if (/^(?:0|[1-9]\d*)$/.test(raw)) {
    return Number(raw);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TypeError("checkpoint is not valid JSON or a legacy row index");
  }
  if (
    parsed === null ||
    parsed.version !== 2 ||
    !Number.isSafeInteger(parsed.nextRow) ||
    parsed.nextRow < 0
  ) {
    throw new TypeError("checkpoint has an invalid version 2 shape");
  }
  return parsed.nextRow;
}

export function serializeCheckpoint(nextRow) {
  if (!Number.isSafeInteger(nextRow) || nextRow < 0) {
    throw new TypeError("nextRow must be a non-negative safe integer");
  }
  return JSON.stringify({ version: 2, nextRow });
}
