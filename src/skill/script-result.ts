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
import { isWellFormedUtf16 } from "./string-safety.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";

const apply = Reflect.apply;
const createObject = Object.create;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const NativeRangeError = RangeError;
const NativeTypeError = TypeError;
const numberIsSafeInteger = Number.isSafeInteger;

function hasOwn(object: object, key: PropertyKey): boolean {
  return apply(hasOwnProperty, object, [key]) as boolean;
}

function inspectResult(value: unknown): {
  readonly stdout: PropertyDescriptor | undefined;
  readonly stderr: PropertyDescriptor | undefined;
  readonly exitCode: PropertyDescriptor | undefined;
} {
  if (typeof value !== "object" || value === null) {
    throw new NativeTypeError("Skill script result must be an object");
  }
  if (isProxyWithoutHooks(value)) {
    throw new NativeTypeError("Skill script result must not be a proxy");
  }

  try {
    return {
      stdout: getOwnPropertyDescriptor(value, "stdout"),
      stderr: getOwnPropertyDescriptor(value, "stderr"),
      exitCode: getOwnPropertyDescriptor(value, "exitCode"),
    };
  } catch (cause) {
    throw new NativeTypeError("Skill script result could not be inspected", { cause });
  }
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
    throw new NativeTypeError(
      `Skill script result ${field} must be an enumerable data property; all result fields must be data properties`,
    );
  }
  return descriptor.value;
}

/**
 * Validate, output-bound, detach, and freeze an executor-provided result.
 */
export function snapshotSkillScriptResult(value: unknown): Readonly<SkillScriptResult> {
  const descriptors = inspectResult(value);
  if (!descriptors.stdout || !descriptors.stderr || !descriptors.exitCode) {
    throw new NativeTypeError(
      "Skill script result must contain stdout, stderr, and exitCode",
    );
  }
  const stdout = readEnumerableDataValue(descriptors.stdout, "stdout");
  const stderr = readEnumerableDataValue(descriptors.stderr, "stderr");
  const exitCode = readEnumerableDataValue(descriptors.exitCode, "exitCode");

  if (typeof stdout !== "string" || typeof stderr !== "string") {
    throw new NativeTypeError("Skill script stdout and stderr must be strings");
  }
  if (!numberIsSafeInteger(exitCode)) {
    throw new NativeTypeError("Skill script exitCode must be a safe integer");
  }
  if (!isWellFormedUtf16(stdout) || !isWellFormedUtf16(stderr)) {
    throw new NativeTypeError("Skill script output must contain well-formed UTF-16");
  }

  const stdoutBytes = utf8ByteLength(stdout, SKILL_SCRIPT_MAX_OUTPUT_BYTES);
  if (stdoutBytes > SKILL_SCRIPT_MAX_OUTPUT_BYTES) {
    throw new NativeRangeError(
      `Skill script output must total at most ${SKILL_SCRIPT_MAX_OUTPUT_BYTES} bytes`,
    );
  }
  if (
    utf8ByteLength(
      stderr,
      SKILL_SCRIPT_MAX_OUTPUT_BYTES - stdoutBytes,
    ) > SKILL_SCRIPT_MAX_OUTPUT_BYTES - stdoutBytes
  ) {
    throw new NativeRangeError(
      `Skill script output must total at most ${SKILL_SCRIPT_MAX_OUTPUT_BYTES} bytes`,
    );
  }

  const snapshot = createObject(null) as {
    stdout: string;
    stderr: string;
    exitCode: number;
  };
  snapshot.stdout = stdout;
  snapshot.stderr = stderr;
  snapshot.exitCode = exitCode as number;
  return freeze(snapshot);
}
