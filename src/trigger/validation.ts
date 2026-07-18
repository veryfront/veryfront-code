import { TRIGGER_CONFIG_INVALID } from "#veryfront/errors";

const ID_PATTERN = /^[a-z0-9][a-z0-9._/-]*$/;

export function validateTriggerId(id: string, label: string): void {
  if (!ID_PATTERN.test(id)) {
    throw TRIGGER_CONFIG_INVALID.create({
      detail:
        `${label} id must start with a lowercase letter or number and use lowercase letters, numbers, dots, underscores, slashes, or hyphens.`,
    });
  }
}

export function assertSerializable(value: unknown, path = "value"): void {
  if (value === undefined) return;
  if (value === null) return;

  const valueType = typeof value;
  if (valueType === "string" || valueType === "number" || valueType === "boolean") return;

  if (valueType === "function" || valueType === "symbol" || valueType === "bigint") {
    throw TRIGGER_CONFIG_INVALID.create({ detail: `${path} must be JSON-serializable.` });
  }

  if (value instanceof Date) {
    throw TRIGGER_CONFIG_INVALID.create({ detail: `${path} must be JSON-serializable.` });
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      assertSerializable(value[index], `${path}[${index}]`);
    }
    return;
  }

  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw TRIGGER_CONFIG_INVALID.create({ detail: `${path} must be JSON-serializable.` });
    }

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      assertSerializable(child, `${path}.${key}`);
    }
  }
}
