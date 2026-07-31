/**
 * Canonical Skill script executor-input boundary.
 *
 * Both built-in executors and extension providers use this snapshot so
 * validation, provenance fields, and mutable argument/environment data cannot
 * diverge or change between preparation and activation.
 */

import { createError, toError } from "#veryfront/errors";
import { isAbortSignalWithoutHooks } from "#veryfront/platform/compat/abort-signal.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";
import {
  isValidSkillScriptEnvironmentKey,
  SKILL_ROOT_PATH_MAX_LENGTH,
  SKILL_SCRIPT_DEFAULT_TIMEOUT_MS,
  SKILL_SCRIPT_MAX_ARG_BYTES_TOTAL,
  SKILL_SCRIPT_MAX_ARG_LENGTH,
  SKILL_SCRIPT_MAX_ARGS,
  SKILL_SCRIPT_MAX_CONTENT_BYTES,
  SKILL_SCRIPT_MAX_ENV_BYTES_TOTAL,
  SKILL_SCRIPT_MAX_ENV_ENTRIES,
  SKILL_SCRIPT_MAX_ENV_KEY_LENGTH,
  SKILL_SCRIPT_MAX_ENV_VALUE_LENGTH,
  SKILL_SCRIPT_MAX_TIMEOUT_MS,
} from "./limits.ts";
import { isWellFormedUtf16 } from "./string-safety.ts";
import type { SkillScriptExecutorInput } from "./types.ts";

const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const createObject = Object.create;
const defineOwnProperty = Object.defineProperty;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const mathFloor = Math.floor;
const mathMin = Math.min;
const NativeRangeError = RangeError;
const NativeTypeError = TypeError;
const NUMBER_MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const numberIsFinite = Number.isFinite;
const ownKeys = Reflect.ownKeys;
const stringIncludes = String.prototype.includes;
const EMPTY_ARGS = freeze([] as string[]);

/** Detached input consumed by core and extension script executors. */
export interface NormalizedSkillScriptExecutorInput {
  /** Script path interpreted by the selected executor. */
  readonly scriptPath: string;
  /** Validated source snapshot when execution originated from a Skill tool. */
  readonly scriptContent?: string;
  /** Detached, frozen positional arguments. */
  readonly args: readonly string[];
  /** Detached, frozen environment override. */
  readonly env?: Readonly<Record<string, string>>;
  /** Optional working directory for direct execution. */
  readonly cwd?: string;
  /** Provenance root that enables the stricter tool-execution limits. */
  readonly validatedSourceRoot?: string;
  /** Normalized execution deadline in whole milliseconds. */
  readonly timeoutMs: number;
  /** Live caller cancellation signal, consumed only through captured native operations. */
  readonly abortSignal?: AbortSignal;
}

function hasOwn(object: object, key: PropertyKey): boolean {
  return apply(hasOwnProperty, object, [key]) as boolean;
}

function appendOwnArrayElement<T>(values: T[], value: T): void {
  defineOwnProperty(values, values.length, createDataDescriptor(value, true, true, true));
}

function createDataDescriptor(
  value: unknown,
  configurable: boolean,
  enumerable: boolean,
  writable: boolean,
): PropertyDescriptor {
  const descriptor = createObject(null) as PropertyDescriptor;
  descriptor.configurable = configurable;
  descriptor.enumerable = enumerable;
  descriptor.value = value;
  descriptor.writable = writable;
  return descriptor;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !arrayIsArray(value);
}

function ownDataValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = getOwnPropertyDescriptor(record, key);
  if (!descriptor) return undefined;
  if (!hasOwn(descriptor, "value")) {
    throw new NativeTypeError(`Skill script field "${key}" must be a data property`);
  }
  return descriptor.value;
}

function requireBoundedString(
  value: unknown,
  field: string,
  maxLength: number,
  allowEmpty = false,
): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw new NativeTypeError(`${field} must be ${allowEmpty ? "a" : "a non-empty"} string`);
  }
  if (!isWellFormedUtf16(value) || apply(stringIncludes, value, ["\0"])) {
    throw new NativeTypeError(`${field} must be valid text without NUL characters`);
  }
  if (value.length > maxLength) {
    throw new NativeRangeError(`${field} must be at most ${maxLength} characters`);
  }
  return value;
}

function resolveTimeoutMs(timeoutMs?: number): number {
  if (timeoutMs === undefined || !numberIsFinite(timeoutMs) || timeoutMs <= 0) {
    return SKILL_SCRIPT_DEFAULT_TIMEOUT_MS;
  }
  return mathMin(mathFloor(timeoutMs), SKILL_SCRIPT_MAX_TIMEOUT_MS);
}

function requireScriptContent(value: unknown, enforceToolLimits: boolean): string {
  const content = requireBoundedString(
    value,
    "Skill script content",
    enforceToolLimits ? SKILL_SCRIPT_MAX_CONTENT_BYTES : NUMBER_MAX_SAFE_INTEGER,
    true,
  );
  if (
    enforceToolLimits &&
    utf8ByteLength(content, SKILL_SCRIPT_MAX_CONTENT_BYTES) >
      SKILL_SCRIPT_MAX_CONTENT_BYTES
  ) {
    throw new NativeRangeError(
      `Skill script content must be at most ${SKILL_SCRIPT_MAX_CONTENT_BYTES} bytes`,
    );
  }
  return content;
}

function normalizeScriptArgs(
  value: unknown,
  enforceToolLimits: boolean,
): readonly string[] {
  if (value === undefined) return EMPTY_ARGS;
  if (!arrayIsArray(value)) {
    throw new NativeTypeError("Skill script args must be an array");
  }
  if (isProxyWithoutHooks(value)) {
    throw new NativeTypeError("Skill script args must not be a proxy");
  }
  if (enforceToolLimits && value.length > SKILL_SCRIPT_MAX_ARGS) {
    throw new NativeRangeError(
      `Skill script args accepts at most ${SKILL_SCRIPT_MAX_ARGS} entries`,
    );
  }

  const args: string[] = [];
  let totalBytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = getOwnPropertyDescriptor(value, index);
    if (!descriptor || !hasOwn(descriptor, "value")) {
      throw new NativeTypeError(`Skill script arg ${index} must be a data property`);
    }
    const arg = requireBoundedString(
      descriptor.value,
      `Skill script arg ${index}`,
      enforceToolLimits ? SKILL_SCRIPT_MAX_ARG_LENGTH : NUMBER_MAX_SAFE_INTEGER,
      true,
    );
    if (enforceToolLimits) {
      const remaining = SKILL_SCRIPT_MAX_ARG_BYTES_TOTAL - totalBytes;
      const bytes = utf8ByteLength(arg, remaining);
      if (bytes > remaining) {
        throw new NativeRangeError(
          `Skill script args must total at most ${SKILL_SCRIPT_MAX_ARG_BYTES_TOTAL} bytes`,
        );
      }
      totalBytes += bytes;
    }
    appendOwnArrayElement(args, arg);
  }
  return freeze(args);
}

function normalizeScriptEnv(
  value: unknown,
  enforceToolLimits: boolean,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (!isObjectRecord(value)) {
    throw new NativeTypeError("Skill script env must be an object");
  }
  if (isProxyWithoutHooks(value)) {
    throw new NativeTypeError("Skill script env must not be a proxy");
  }

  const descriptors = getOwnPropertyDescriptors(value);
  const entries: Array<readonly [string, PropertyDescriptor]> = [];
  const descriptorKeys = ownKeys(descriptors);
  for (let index = 0; index < descriptorKeys.length; index += 1) {
    const key = descriptorKeys[index]!;
    const descriptor = descriptors[key as keyof typeof descriptors];
    if (!descriptor?.enumerable) continue;
    if (typeof key !== "string") {
      throw new NativeTypeError("Skill script env keys must be strings");
    }
    appendOwnArrayElement(entries, [key, descriptor] as const);
  }
  if (enforceToolLimits && entries.length > SKILL_SCRIPT_MAX_ENV_ENTRIES) {
    throw new NativeRangeError(
      `Skill script env accepts at most ${SKILL_SCRIPT_MAX_ENV_ENTRIES} entries`,
    );
  }

  const env = createObject(null) as Record<string, string>;
  let totalBytes = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const key = entry[0];
    const descriptor = entry[1];
    if (!hasOwn(descriptor, "value")) {
      throw new NativeTypeError(`Skill script env "${key}" must be a data property`);
    }
    if (!isValidSkillScriptEnvironmentKey(key)) {
      throw toError(
        createError({
          type: "agent",
          message: `Invalid environment variable name: "${key}"`,
        }),
      );
    }
    if (enforceToolLimits && key.length > SKILL_SCRIPT_MAX_ENV_KEY_LENGTH) {
      throw new NativeRangeError(
        `Skill script environment names must be at most ${SKILL_SCRIPT_MAX_ENV_KEY_LENGTH} characters`,
      );
    }
    const envValue = requireBoundedString(
      descriptor.value,
      `Skill script environment value for "${key}"`,
      enforceToolLimits ? SKILL_SCRIPT_MAX_ENV_VALUE_LENGTH : NUMBER_MAX_SAFE_INTEGER,
      true,
    );
    if (enforceToolLimits) {
      const remaining = SKILL_SCRIPT_MAX_ENV_BYTES_TOTAL - totalBytes;
      const bytes = utf8ByteLength(`${key}=${envValue}\0`, remaining);
      if (bytes > remaining) {
        throw new NativeRangeError(
          `Skill script environment must total at most ${SKILL_SCRIPT_MAX_ENV_BYTES_TOTAL} bytes`,
        );
      }
      totalBytes += bytes;
    }
    defineOwnProperty(env, key, createDataDescriptor(envValue, false, true, false));
  }
  return freeze(env);
}

/** Validate, detach, and freeze one script executor input. */
export function snapshotSkillScriptExecutorInput(
  input: Readonly<SkillScriptExecutorInput>,
): Readonly<NormalizedSkillScriptExecutorInput> {
  if (!isObjectRecord(input)) {
    throw new NativeTypeError("Skill script executor input must be an object");
  }
  if (isProxyWithoutHooks(input)) {
    throw new NativeTypeError("Skill script executor input must not be a proxy");
  }

  const rawValidatedSourceRoot = ownDataValue(input, "validatedSourceRoot");
  const validatedSourceRoot = rawValidatedSourceRoot === undefined
    ? undefined
    : requireBoundedString(
      rawValidatedSourceRoot,
      "Skill script validated source root",
      SKILL_ROOT_PATH_MAX_LENGTH,
    );
  const enforceToolLimits = validatedSourceRoot !== undefined;
  const scriptPath = requireBoundedString(
    ownDataValue(input, "scriptPath"),
    "Skill script path",
    enforceToolLimits ? SKILL_ROOT_PATH_MAX_LENGTH : NUMBER_MAX_SAFE_INTEGER,
  );
  const rawScriptContent = ownDataValue(input, "scriptContent");
  const scriptContent = rawScriptContent === undefined
    ? undefined
    : requireScriptContent(rawScriptContent, enforceToolLimits);
  const rawCwd = ownDataValue(input, "cwd");
  const cwd = rawCwd === undefined ? undefined : requireBoundedString(
    rawCwd,
    "Skill script cwd",
    enforceToolLimits ? SKILL_ROOT_PATH_MAX_LENGTH : NUMBER_MAX_SAFE_INTEGER,
  );
  const timeoutMs = resolveTimeoutMs(
    ownDataValue(input, "timeoutMs") as number | undefined,
  );
  const rawAbortSignal = ownDataValue(input, "abortSignal");
  if (rawAbortSignal !== undefined && !isAbortSignalWithoutHooks(rawAbortSignal)) {
    throw new NativeTypeError("Skill script abortSignal must be an AbortSignal");
  }
  const env = normalizeScriptEnv(ownDataValue(input, "env"), enforceToolLimits);

  return freeze({
    scriptPath,
    ...(scriptContent === undefined ? {} : { scriptContent }),
    args: normalizeScriptArgs(ownDataValue(input, "args"), enforceToolLimits),
    ...(env === undefined ? {} : { env }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(validatedSourceRoot === undefined ? {} : { validatedSourceRoot }),
    timeoutMs,
    ...(rawAbortSignal === undefined ? {} : { abortSignal: rawAbortSignal }),
  });
}
