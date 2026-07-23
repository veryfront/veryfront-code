import { CONFIG_INVALID } from "#veryfront/errors/error-registry/config.ts";

export function invalidFSAdapterConfig(detail: string): never {
  throw CONFIG_INVALID.create({ detail });
}

export function assertReadableConfigObject(
  value: unknown,
  label: string,
): asserts value is object {
  if (typeof value !== "object" || value === null) {
    invalidFSAdapterConfig(`${label} must be an object`);
  }

  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    invalidFSAdapterConfig(`${label} is not readable`);
  }
  if (isArray) invalidFSAdapterConfig(`${label} must be an object`);
}

export function readConfigProperty(
  value: object,
  property: PropertyKey,
  label: string,
): unknown {
  try {
    return Reflect.get(value, property);
  } catch {
    invalidFSAdapterConfig(`${label} is not readable`);
  }
}
