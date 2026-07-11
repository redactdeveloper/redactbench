function serialize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("stable JSON cannot encode non-finite numbers");
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => serialize(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`);
    return `{${entries.join(",")}}`;
  }

  throw new TypeError(`stable JSON cannot encode ${typeof value}`);
}

export function stableStringify(value: unknown): string {
  return serialize(value);
}
