import { INPUT_VALIDATION_FAILED } from "#veryfront/errors/error-registry/general.ts";
import {
  getUTF8ByteLength,
  MAX_HTML_HYDRATION_PARAM_VALUES,
  MAX_HTML_HYDRATION_PARAMS,
  MAX_HTML_PATH_BYTES,
} from "./limits.ts";
import { hasPathControlCharacter } from "./path-safety.ts";
import { hasUnpairedUtf16Surrogate, hasUnsafeUnicodeFormatting } from "./unicode-safety.ts";

const UNSAFE_PARAM_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function invalidParams(detail: string): Error {
  return INPUT_VALIDATION_FAILED.create({ detail });
}

function isSafeParamText(value: string, allowEmpty: boolean): boolean {
  return (allowEmpty || value.length > 0) && value.length <= MAX_HTML_PATH_BYTES &&
    getUTF8ByteLength(value) <= MAX_HTML_PATH_BYTES && !hasPathControlCharacter(value) &&
    !hasUnpairedUtf16Surrogate(value) && !hasUnsafeUnicodeFormatting(value);
}

function snapshotParamArray(value: unknown): string[] {
  let isArray: boolean;
  let lengthDescriptor: PropertyDescriptor | undefined;
  let keys: PropertyKey[];
  try {
    isArray = Array.isArray(value);
  } catch {
    throw invalidParams("Hydration params cannot be inspected");
  }
  if (!isArray) throw invalidParams("Hydration params contain an invalid value");
  try {
    lengthDescriptor = Reflect.getOwnPropertyDescriptor(value as object, "length");
    keys = Reflect.ownKeys(value as object);
  } catch {
    throw invalidParams("Hydration params cannot be inspected");
  }
  const length = lengthDescriptor?.value;
  if (
    !Number.isSafeInteger(length) || (length as number) < 0 ||
    (length as number) > MAX_HTML_HYDRATION_PARAM_VALUES
  ) {
    throw invalidParams("Hydration params contain an invalid value");
  }

  const descriptors: Array<PropertyDescriptor | undefined> = new Array(length as number);
  for (const key of keys) {
    if (key === "length") continue;
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value as object, key);
    } catch {
      throw invalidParams("Hydration params cannot be inspected");
    }
    if (!descriptor) throw invalidParams("Hydration params cannot be inspected");
    if (typeof key === "symbol") {
      if (descriptor.enumerable) {
        throw invalidParams("Hydration params contain an invalid value");
      }
      continue;
    }
    const index = Number(key);
    if (
      Number.isSafeInteger(index) && index >= 0 && index < (length as number) &&
      String(index) === key
    ) {
      descriptors[index] = descriptor;
      continue;
    }
    if (descriptor.enumerable) {
      throw invalidParams("Hydration params contain an invalid value");
    }
  }

  const result: string[] = [];
  let totalBytes = 0;
  for (let index = 0; index < (length as number); index++) {
    const descriptor = descriptors[index];
    if (!descriptor || descriptor.get || descriptor.set || !("value" in descriptor)) {
      throw invalidParams("Hydration params cannot be inspected");
    }
    const item = descriptor.value;
    if (typeof item !== "string" || !isSafeParamText(item, true)) {
      throw invalidParams("Hydration params contain an invalid value");
    }
    totalBytes += getUTF8ByteLength(item) + (index > 0 ? 1 : 0);
    if (totalBytes > MAX_HTML_PATH_BYTES) {
      throw invalidParams("Hydration params contain an oversized value");
    }
    result.push(item);
  }
  return result;
}

/** Validate and copy route params before embedding them in hydration data. */
export function snapshotHydrationParams(
  value: unknown,
): Record<string, string | string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidParams("Hydration params must be an object");
  }

  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    throw invalidParams("Hydration params cannot be inspected");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidParams("Hydration params must be a plain object");
  }
  const result: Record<string, string | string[]> = {};
  let entryCount = 0;
  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    } catch {
      throw invalidParams("Hydration params cannot be inspected");
    }
    if (!descriptor) throw invalidParams("Hydration params cannot be inspected");
    if (!descriptor.enumerable) continue;
    if (typeof key !== "string") {
      throw invalidParams("Hydration params contain an invalid key");
    }
    entryCount++;
    if (entryCount > MAX_HTML_HYDRATION_PARAMS) {
      throw invalidParams("Hydration params exceed the entry limit");
    }
    if (UNSAFE_PARAM_KEYS.has(key) || !isSafeParamText(key, false)) {
      throw invalidParams("Hydration params contain an invalid key");
    }
    if (descriptor.get || descriptor.set || !("value" in descriptor)) {
      throw invalidParams("Hydration params cannot be inspected");
    }
    const parameter = descriptor.value;
    const snapshot = typeof parameter === "string" ? parameter : snapshotParamArray(parameter);
    if (typeof snapshot === "string" && !isSafeParamText(snapshot, true)) {
      throw invalidParams("Hydration params contain an invalid value");
    }
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: snapshot,
      writable: true,
    });
  }
  return result;
}
