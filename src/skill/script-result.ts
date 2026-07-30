/**
 * Skill script result boundary.
 *
 * Executors and extension providers are implementation boundaries. Their
 * results are inspected without invoking accessors, detached from mutable
 * source objects, and bounded before core returns or retains them.
 */

import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { SKILL_SCRIPT_MAX_OUTPUT_BYTES } from "./limits.ts";
import type { SkillScriptResult } from "./types.ts";

const apply = Reflect.apply;
const freeze = Object.freeze;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const getPrototypeOf = Object.getPrototypeOf;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const NativeObjectPrototype = Object.prototype;
const numberIsSafeInteger = Number.isSafeInteger;
const ownKeys = Reflect.ownKeys;
const stringCharCodeAt = String.prototype.charCodeAt;

function hasOwn(object: object, key: PropertyKey): boolean {
  return apply(hasOwnProperty, object, [key]) as boolean;
}

function inspectResult(value: unknown): Record<PropertyKey, PropertyDescriptor> {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Skill script result must be an object");
  }
  if (isProxyWithoutHooks(value)) {
    throw new TypeError("Skill script result must not be a proxy");
  }

  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    prototype = getPrototypeOf(value);
    descriptors = getOwnPropertyDescriptors(value) as Record<
      PropertyKey,
      PropertyDescriptor
    >;
  } catch (cause) {
    throw new TypeError("Skill script result could not be inspected", { cause });
  }
  if (prototype !== NativeObjectPrototype && prototype !== null) {
    throw new TypeError("Skill script result must be a plain object");
  }

  const keys = ownKeys(descriptors);
  if (
    keys.length !== 3 ||
    !hasOwn(descriptors, "stdout") ||
    !hasOwn(descriptors, "stderr") ||
    !hasOwn(descriptors, "exitCode")
  ) {
    throw new TypeError(
      "Skill script result must contain only stdout, stderr, and exitCode",
    );
  }
  return descriptors;
}

function readEnumerableDataValue(
  descriptor: PropertyDescriptor | undefined,
  field: string,
): unknown {
  if (
    descriptor === undefined ||
    descriptor.enumerable !== true ||
    !hasOwn(descriptor, "value")
  ) {
    throw new TypeError(
      `Skill script result ${field} must be an enumerable data property; all result fields must be data properties`,
    );
  }
  return descriptor.value;
}

function utf8ByteLengthWithin(value: string, maxBytes: number): number | undefined {
  let byteLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = apply(stringCharCodeAt, value, [index]) as number;
    if (code <= 0x7f) {
      byteLength += 1;
    } else if (code <= 0x7ff) {
      byteLength += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = apply(stringCharCodeAt, value, [index + 1]) as number;
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        throw new TypeError("Skill script output must contain well-formed UTF-16");
      }
      byteLength += 4;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError("Skill script output must contain well-formed UTF-16");
    } else {
      byteLength += 3;
    }
    if (byteLength > maxBytes) return undefined;
  }
  return byteLength;
}

/**
 * Validate, output-bound, detach, and freeze an executor-provided result.
 */
export function snapshotSkillScriptResult(value: unknown): Readonly<SkillScriptResult> {
  const descriptors = inspectResult(value);
  const stdout = readEnumerableDataValue(descriptors.stdout, "stdout");
  const stderr = readEnumerableDataValue(descriptors.stderr, "stderr");
  const exitCode = readEnumerableDataValue(descriptors.exitCode, "exitCode");

  if (typeof stdout !== "string" || typeof stderr !== "string") {
    throw new TypeError("Skill script stdout and stderr must be strings");
  }
  if (!numberIsSafeInteger(exitCode)) {
    throw new TypeError("Skill script exitCode must be a safe integer");
  }

  const stdoutBytes = utf8ByteLengthWithin(stdout, SKILL_SCRIPT_MAX_OUTPUT_BYTES);
  if (stdoutBytes === undefined) {
    throw new RangeError(
      `Skill script output must total at most ${SKILL_SCRIPT_MAX_OUTPUT_BYTES} bytes`,
    );
  }
  if (
    utf8ByteLengthWithin(
      stderr,
      SKILL_SCRIPT_MAX_OUTPUT_BYTES - stdoutBytes,
    ) === undefined
  ) {
    throw new RangeError(
      `Skill script output must total at most ${SKILL_SCRIPT_MAX_OUTPUT_BYTES} bytes`,
    );
  }

  return freeze({ stdout, stderr, exitCode: exitCode as number });
}
