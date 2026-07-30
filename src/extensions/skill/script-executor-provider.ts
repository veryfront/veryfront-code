/**
 * Extension boundary for lifecycle-owned skill script execution.
 *
 * Application composition may explicitly select and snapshot one provider.
 * This authoring contract does not register or auto-resolve implementations.
 * Implementations own every process, request, and remote resource created for
 * an execution and expose one terminal settlement that completes only after
 * those resources are released.
 *
 * @module extensions/skill/script-executor-provider
 */

import {
  isNativePromiseWithoutHooks,
  isProxyWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";
import type { SkillScriptExecutorInput, SkillScriptResult } from "#veryfront/skill/types.ts";
import { snapshotSkillScriptResult } from "#veryfront/skill/script-result.ts";

const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const freeze = Object.freeze;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const getPrototypeOf = Object.getPrototypeOf;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const NativeObjectPrototype = Object.prototype;
const NativeTypeError = TypeError;
const ownKeys = Reflect.ownKeys;

/** Contract name registered by one composed script-execution extension. */
export const SkillScriptExecutorProviderName = "SkillScriptExecutorProvider" as const;

/**
 * One provider-owned execution lifecycle.
 *
 * `result` represents the script outcome. `terminal` settles only after the
 * result and all provider-owned cleanup have settled. `terminate` initiates
 * cancellation synchronously and must be idempotent; asynchronous termination
 * failures are reported by `terminal`. The snapshot wrapper validates and
 * detaches successful results, delays terminal settlement until the result has
 * settled, and forwards termination at most once.
 */
export interface SkillScriptExecutionHandle {
  readonly result: Promise<SkillScriptResult>;
  terminate(reason?: unknown): void;
  readonly terminal: Promise<void>;
}

/** Extension-owned implementation selected by application composition. */
export interface SkillScriptExecutorProvider {
  /**
   * Return ownership synchronously, before spawning or provisioning work that
   * core could not terminate through the returned handle.
   */
  start(input: Readonly<SkillScriptExecutorInput>): SkillScriptExecutionHandle;
}

type DescriptorMap = Record<PropertyKey, PropertyDescriptor>;
type PromiseSettlement<T> =
  | { readonly fulfilled: true; readonly value: T }
  | { readonly fulfilled: false; readonly reason: unknown };

function hasOwn(object: object, key: PropertyKey): boolean {
  return apply(hasOwnProperty, object, [key]) as boolean;
}

function containsOnlyExpectedKeys(
  keys: readonly PropertyKey[],
  expectedKeys: readonly string[],
): boolean {
  if (keys.length !== expectedKeys.length) return false;
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = keys[keyIndex];
    let matched = false;
    for (let expectedIndex = 0; expectedIndex < expectedKeys.length; expectedIndex += 1) {
      if (key === expectedKeys[expectedIndex]) {
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
}

function inspectExactPlainObject(
  value: unknown,
  label: string,
  expectedKeys: readonly string[],
): DescriptorMap {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    throw new NativeTypeError(`${label} must be an object`);
  }
  if (isProxyWithoutHooks(value)) {
    throw new NativeTypeError(`${label} must not be a proxy`);
  }

  let isArray: boolean;
  let prototype: object | null;
  let descriptors: DescriptorMap;
  try {
    isArray = arrayIsArray(value);
    prototype = getPrototypeOf(value);
    descriptors = getOwnPropertyDescriptors(value) as DescriptorMap;
  } catch (cause) {
    throw new NativeTypeError(`${label} could not be inspected`, { cause });
  }

  if (isArray) throw new NativeTypeError(`${label} must be an object`);
  if (prototype !== NativeObjectPrototype && prototype !== null) {
    throw new NativeTypeError(`${label} must be a plain object`);
  }

  if (!containsOnlyExpectedKeys(ownKeys(descriptors), expectedKeys)) {
    throw new NativeTypeError(
      `${label} must contain only its documented own properties`,
    );
  }

  return descriptors;
}

function captureDataFunction(
  descriptor: PropertyDescriptor | undefined,
  label: string,
): (...args: unknown[]) => unknown {
  const candidate = descriptor && hasOwn(descriptor, "value") ? descriptor.value : undefined;
  if (
    descriptor === undefined ||
    descriptor.enumerable !== true ||
    !hasOwn(descriptor, "value") ||
    typeof candidate !== "function" ||
    isProxyWithoutHooks(candidate)
  ) {
    throw new NativeTypeError(
      `${label} must be an enumerable, non-proxy function data property`,
    );
  }
  return candidate as (...args: unknown[]) => unknown;
}

function capturePromise<T>(
  descriptor: PropertyDescriptor | undefined,
  label: string,
): Promise<T> {
  const candidate = descriptor && hasOwn(descriptor, "value") ? descriptor.value : undefined;
  if (
    descriptor === undefined ||
    descriptor.enumerable !== true ||
    !hasOwn(descriptor, "value") ||
    isProxyWithoutHooks(candidate) ||
    !isNativePromiseWithoutHooks(candidate)
  ) {
    throw new NativeTypeError(
      `${label} must be an enumerable, genuine Promise data property`,
    );
  }
  return candidate as Promise<T>;
}

async function observePromiseSettlement<T>(promise: Promise<T>): Promise<PromiseSettlement<T>> {
  try {
    return { fulfilled: true, value: await promise };
  } catch (reason) {
    return { fulfilled: false, reason };
  }
}

async function waitForTerminalSettlement(
  resultSettlement: Promise<PromiseSettlement<SkillScriptResult>>,
  terminalSettlement: Promise<PromiseSettlement<void>>,
): Promise<void> {
  await resultSettlement;
  const settlement = await terminalSettlement;
  if (!settlement.fulfilled) throw settlement.reason;
}

/**
 * Capture an execution handle without invoking accessors or retaining mutable
 * method properties from the extension-owned object.
 */
export function snapshotSkillScriptExecutionHandle(
  value: unknown,
): Readonly<SkillScriptExecutionHandle> {
  if (isNativePromiseWithoutHooks(value)) {
    throw new NativeTypeError(
      "Skill script executor provider start() must return an execution handle synchronously, not a Promise",
    );
  }

  const descriptors = inspectExactPlainObject(
    value,
    "Skill script execution handle",
    ["result", "terminate", "terminal"],
  );
  const capturedResult = capturePromise<SkillScriptResult>(
    descriptors.result,
    "Skill script execution handle result",
  );
  const capturedTerminate = captureDataFunction(
    descriptors.terminate,
    "Skill script execution handle terminate",
  );
  const capturedTerminal = capturePromise<void>(
    descriptors.terminal,
    "Skill script execution handle terminal",
  );

  let terminationStarted = false;
  const terminate = freeze((reason?: unknown): void => {
    if (terminationStarted) return;
    terminationStarted = true;
    apply(capturedTerminate, undefined, [reason]);
  });
  const result =
    (async (): Promise<SkillScriptResult> => snapshotSkillScriptResult(await capturedResult))();
  const resultSettlement = observePromiseSettlement(result);
  const terminalSettlement = observePromiseSettlement(capturedTerminal);
  const terminal = waitForTerminalSettlement(resultSettlement, terminalSettlement);

  return freeze({ result, terminate, terminal });
}

/**
 * Capture a provider and validate every handle returned by its synchronous
 * `start()` boundary.
 */
export function snapshotSkillScriptExecutorProvider(
  value: unknown,
): Readonly<SkillScriptExecutorProvider> {
  const descriptors = inspectExactPlainObject(
    value,
    "Skill script executor provider",
    ["start"],
  );
  const capturedStart = captureDataFunction(
    descriptors.start,
    "Skill script executor provider start",
  );

  const start = freeze(
    (input: Readonly<SkillScriptExecutorInput>): Readonly<SkillScriptExecutionHandle> => {
      const handle = apply(capturedStart, undefined, [input]);
      return snapshotSkillScriptExecutionHandle(handle);
    },
  );

  return freeze({ start });
}
