import { TRIGGER_CONFIG_INVALID } from "#veryfront/errors";

const ID_PATTERN = /^[a-z0-9][a-z0-9._/-]*$/;

export function isTriggerId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function validateTriggerId(id: string, label: string): void {
  if (!isTriggerId(id)) {
    throw TRIGGER_CONFIG_INVALID.create({
      detail:
        `${label} id must start with a lowercase letter or number and use lowercase letters, numbers, dots, underscores, slashes, or hyphens.`,
    });
  }
}

export function assertSerializable(value: unknown, path = "value"): void {
  assertSerializableValue(value, path, new WeakSet<object>());
}

function throwNotSerializable(path: string): never {
  throw TRIGGER_CONFIG_INVALID.create({ detail: `${path} must be JSON-serializable.` });
}

function assertSerializableValue(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): void {
  if (value === undefined) return;
  if (value === null) return;

  const valueType = typeof value;
  if (valueType === "string" || valueType === "boolean") return;
  if (valueType === "number") {
    if (!Number.isFinite(value)) throwNotSerializable(path);
    return;
  }

  if (valueType === "function" || valueType === "symbol" || valueType === "bigint") {
    throwNotSerializable(path);
  }

  let isDate: boolean;
  try {
    isDate = value instanceof Date;
  } catch {
    throwNotSerializable(path);
  }
  if (isDate) {
    throwNotSerializable(path);
  }

  let toJSON: unknown;
  try {
    toJSON = (value as { toJSON?: unknown }).toJSON;
  } catch {
    throwNotSerializable(path);
  }
  if (typeof toJSON === "function") {
    throwNotSerializable(path);
  }

  const objectValue = value as object;
  if (ancestors.has(objectValue)) throwNotSerializable(path);
  ancestors.add(objectValue);

  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        let child: unknown;
        try {
          child = value[index];
        } catch {
          throwNotSerializable(`${path}[${index}]`);
        }
        assertSerializableValue(child, `${path}[${index}]`, ancestors);
      }
      return;
    }

    let prototype: object | null;
    try {
      prototype = Object.getPrototypeOf(value);
    } catch {
      throwNotSerializable(path);
    }
    if (prototype !== Object.prototype && prototype !== null) {
      throwNotSerializable(path);
    }

    let entries: [string, unknown][];
    try {
      entries = Object.entries(value as Record<string, unknown>);
    } catch {
      throwNotSerializable(path);
    }
    for (const [key, child] of entries) {
      assertSerializableValue(child, `${path}.${key}`, ancestors);
    }
  } finally {
    ancestors.delete(objectValue);
  }
}
