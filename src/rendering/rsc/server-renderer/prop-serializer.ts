import { serverLogger as logger } from "#veryfront/utils";

const log = logger.component("rsc");

export function serializeProps(props: Record<string, unknown>): Record<string, unknown> {
  const serializable: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(props)) {
    if (key === "children") continue;

    if (!isSerializable(value)) {
      log.warn(`Skipping non-serializable prop: ${key}`);
      continue;
    }

    serializable[key] = value;
  }

  return serializable;
}

export function stringifyProps(props: Record<string, unknown>): string {
  const seen = new WeakSet<object>();

  return JSON.stringify(props, (_key, value) => {
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return undefined;

    seen.add(value);
    return value;
  });
}

function isSerializable(value: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  if (value == null) return true;

  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return true;
    case "function":
    case "symbol":
    case "bigint":
      return false;
    case "object":
      break;
    default:
      return false;
  }

  const obj = value as object;
  if (seen.has(obj)) return false;
  seen.add(obj);

  if (Array.isArray(value)) {
    return value.every((item) => isSerializable(item, seen));
  }

  try {
    for (const v of Object.values(value as Record<string, unknown>)) {
      if (!isSerializable(v, seen)) return false;
    }
    return true;
  } catch {
    return false;
  }
}
