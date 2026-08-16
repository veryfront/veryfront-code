import { INVALID_ARGUMENT } from "#veryfront/errors";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import {
  MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES,
  MAX_WORKFLOW_DEFINITION_DEPTH,
  MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS,
  MAX_WORKFLOW_DEFINITION_NODES,
  MAX_WORKFLOW_DEFINITION_STATIC_BYTES,
  MAX_WORKFLOW_DEFINITION_STATIC_VALUES,
  MAX_WORKFLOW_DEFINITION_TEXT_CODE_UNITS,
} from "../limits.ts";
import type {
  RetryConfig,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowNodeConfig,
} from "../types.ts";
import {
  parseDurationWithLabel,
  parsePositiveDurationWithLabel,
  validateRetryConfig,
} from "../types.ts";
import { INTERNAL_DELAY_EVENT_NAME, INTERNAL_WAIT_KIND_FIELD } from "../timed-wait-state.ts";

const DEFINITION_KEYS = new Set([
  "id",
  "description",
  "version",
  "inputSchema",
  "outputSchema",
  "retry",
  "timeout",
  "introspect",
  "steps",
  "onError",
  "onComplete",
]);
const CAPTURE_DEFINITION_OPTION_KEYS = new Set(["allowEmptySteps"]);
const NODE_KEYS = new Set(["id", "config", "dependsOn"]);
const RETRY_KEYS = new Set([
  "maxAttempts",
  "initialDelay",
  "maxDelay",
  "backoff",
  "retryIf",
]);
const COMMON_CONFIG_KEYS = ["type", "checkpoint", "retry", "timeout", "skip"] as const;
const CONFIG_KEYS = {
  step: new Set([...COMMON_CONFIG_KEYS, "agent", "tool", "input"]),
  parallel: new Set([...COMMON_CONFIG_KEYS, "nodes", "strategy"]),
  branch: new Set([...COMMON_CONFIG_KEYS, "condition", "then", "else"]),
  wait: new Set([
    ...COMMON_CONFIG_KEYS,
    "waitType",
    "message",
    "payload",
    "approvers",
    "eventName",
    INTERNAL_WAIT_KIND_FIELD,
  ]),
  subWorkflow: new Set([...COMMON_CONFIG_KEYS, "workflow", "input", "output"]),
  map: new Set([...COMMON_CONFIG_KEYS, "items", "processor", "concurrency"]),
  loop: new Set([
    ...COMMON_CONFIG_KEYS,
    "while",
    "steps",
    "maxIterations",
    "onMaxIterations",
    "onComplete",
    "iterationTimeout",
    "delay",
  ]),
} as const;

const RESERVED_CONTEXT_NODE_IDS = new Set(["input", "env", "_tenant", "_loop"]);
const LOOP_STATE_SUFFIX = "_loop_state";

const mapSizeGetter = Object.getOwnPropertyDescriptor(Map.prototype, "size")?.get;
const setSizeGetter = Object.getOwnPropertyDescriptor(Set.prototype, "size")?.get;
const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;
const sharedArrayBufferPrototype = globalThis.SharedArrayBuffer?.prototype;
const sharedArrayBufferByteLengthGetter = sharedArrayBufferPrototype
  ? Object.getOwnPropertyDescriptor(sharedArrayBufferPrototype, "byteLength")?.get
  : undefined;
const dataViewByteLengthGetter = Object.getOwnPropertyDescriptor(
  DataView.prototype,
  "byteLength",
)?.get;
const dataViewBufferGetter = Object.getOwnPropertyDescriptor(DataView.prototype, "buffer")?.get;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "length",
)?.get;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "buffer",
)?.get;
const regexpSourceGetter = Object.getOwnPropertyDescriptor(RegExp.prototype, "source")?.get;
const mapEntries = Map.prototype.entries;
const setValues = Set.prototype.values;
const mapIteratorNext = Object.getPrototypeOf(new Map().entries()).next as (
  this: IterableIterator<[unknown, unknown]>,
) => IteratorResult<[unknown, unknown]>;
const setIteratorNext = Object.getPrototypeOf(new Set().values()).next as (
  this: IterableIterator<unknown>,
) => IteratorResult<unknown>;

interface StaticBudget {
  bytes: number;
  values: number;
}

interface CaptureState {
  readonly activeDefinitions: WeakSet<object>;
  readonly activeNodes: WeakSet<object>;
  readonly staticBudget: StaticBudget;
  nodeCount: number;
}

interface StaticInspectionState {
  readonly active: WeakSet<object>;
  readonly seen: WeakSet<object>;
  readonly budget: StaticBudget;
}

type ExactRecord = ReadonlyMap<string, unknown>;

function createCaptureState(): CaptureState {
  return {
    activeDefinitions: new WeakSet(),
    activeNodes: new WeakSet(),
    staticBudget: { bytes: 0, values: 0 },
    nodeCount: 0,
  };
}

function fail(detail: string, cause?: unknown): never {
  throw INVALID_ARGUMENT.create({ detail, ...(cause === undefined ? {} : { cause }) });
}

function assertDepth(depth: number, label: string): void {
  if (depth <= MAX_WORKFLOW_DEFINITION_DEPTH) return;
  fail(`${label} exceeds maximum nesting depth ${MAX_WORKFLOW_DEFINITION_DEPTH}`);
}

function addBudget(
  budget: StaticBudget,
  label: string,
  values = 1,
  bytes = 0,
): void {
  budget.values += values;
  budget.bytes += bytes;
  if (budget.values > MAX_WORKFLOW_DEFINITION_STATIC_VALUES) {
    fail(`${label} exceeds maximum static value count ${MAX_WORKFLOW_DEFINITION_STATIC_VALUES}`);
  }
  if (budget.bytes > MAX_WORKFLOW_DEFINITION_STATIC_BYTES) {
    fail(`${label} exceeds maximum static size ${MAX_WORKFLOW_DEFINITION_STATIC_BYTES} bytes`);
  }
}

function assertPlainStructuralRecord(value: object, label: string): void {
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
  } catch (cause) {
    fail(`${label} could not be inspected`, cause);
  }
  if (prototype === null) return;
  if (isProxyWithoutHooks(prototype)) fail(`${label} must not inherit from a Proxy`);
  let parent: object | null;
  try {
    parent = Object.getPrototypeOf(prototype) as object | null;
  } catch (cause) {
    fail(`${label} prototype could not be inspected`, cause);
  }
  if (parent !== null) fail(`${label} must be a plain record`);
}

function inspectExactRecord(
  value: unknown,
  label: string,
  allowedKeys: ReadonlySet<string>,
  requiredKeys: readonly string[] = [],
): ExactRecord {
  if (
    (typeof value !== "object" && typeof value !== "function") || value === null ||
    isProxyWithoutHooks(value)
  ) {
    fail(`${label} must be a non-Proxy plain record`);
  }
  if (Array.isArray(value)) fail(`${label} must be a plain record`);
  assertPlainStructuralRecord(value, label);

  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch (cause) {
    fail(`${label} could not be inspected`, cause);
  }
  if (keys.length > MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES) {
    fail(`${label} contains too many fields`);
  }

  const fields = new Map<string, unknown>();
  for (const key of keys) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      fail(
        `${label} contains unsupported field ${typeof key === "string" ? `"${key}"` : "symbol"}`,
      );
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (cause) {
      fail(`${label} field "${key}" could not be inspected`, cause);
    }
    if (!descriptor || !("value" in descriptor)) {
      fail(`${label} field "${key}" must be an own data property`);
    }
    fields.set(key, descriptor.value);
  }
  for (const key of requiredKeys) {
    if (!fields.has(key)) fail(`${label} must contain own data property "${key}"`);
  }
  return fields;
}

function inspectDenseArrayValues(value: unknown, label: string): unknown[] {
  if (typeof value !== "object" || value === null || isProxyWithoutHooks(value)) {
    fail(`${label} must be a non-Proxy array`);
  }
  if (!Array.isArray(value)) fail(`${label} must be an array`);

  let keys: PropertyKey[];
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    keys = Reflect.ownKeys(value);
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  } catch (cause) {
    fail(`${label} could not be inspected`, cause);
  }
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (!Number.isSafeInteger(length) || length < 0) fail(`${label} has an invalid length`);
  if (length > MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES) {
    fail(`${label} cannot contain more than ${MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES} entries`);
  }
  if (
    keys.length !== length + 1 || keys.some((key) => key !== "length" && typeof key !== "string")
  ) {
    fail(`${label} must be dense and contain no custom properties`);
  }

  const values: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const key = String(index);
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (cause) {
      fail(`${label} entry ${index} could not be inspected`, cause);
    }
    if (!descriptor || !("value" in descriptor)) {
      fail(`${label} must be dense; entry ${index} is missing or is an accessor`);
    }
    values.push(descriptor.value);
  }
  return values;
}

function assertString(
  value: unknown,
  label: string,
  maxLength = MAX_WORKFLOW_DEFINITION_TEXT_CODE_UNITS,
  requireCanonical = false,
): asserts value is string {
  if (
    typeof value !== "string" || value.length > maxLength ||
    (requireCanonical && (value.length === 0 || value.trim() !== value))
  ) {
    fail(
      requireCanonical
        ? `${label} must be a canonical non-empty string of at most ${maxLength} code units`
        : `${label} must be a string of at most ${maxLength} code units`,
    );
  }
}

function assertOptionalFunction(value: unknown, label: string): void {
  if (value === undefined) return;
  assertFunction(value, label);
}

function assertFunction(value: unknown, label: string): asserts value is CallableFunction {
  if (typeof value !== "function" || isProxyWithoutHooks(value)) {
    fail(`${label} must be a non-Proxy function`);
  }
}

function assertDurationValue(
  value: unknown,
  label: string,
  positive: boolean,
): asserts value is string | number {
  if (typeof value !== "string" && typeof value !== "number") {
    fail(`${label} must be a string or number`);
  }
  if (positive) parsePositiveDurationWithLabel(value, label);
  else parseDurationWithLabel(value, label);
}

function assertNodeId(value: unknown, label: string): asserts value is string {
  assertString(value, label, MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS, true);
  if (RESERVED_CONTEXT_NODE_IDS.has(value) || value.endsWith(LOOP_STATE_SUFFIX)) {
    fail(`${label} uses reserved workflow context namespace "${value}"`);
  }
}

function callGetter(getter: ((this: unknown) => unknown) | undefined, value: object): unknown {
  if (!getter) return undefined;
  return Reflect.apply(getter, value, []);
}

function tryGetter(
  getter: ((this: unknown) => unknown) | undefined,
  value: object,
): { matched: false } | { matched: true; value: unknown } {
  if (!getter) return { matched: false };
  try {
    return { matched: true, value: callGetter(getter, value) };
  } catch {
    return { matched: false };
  }
}

function assertNoOwnFields(value: object, label: string): void {
  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch (cause) {
    fail(`${label} could not be inspected`, cause);
  }
  if (keys.length !== 0) fail(`${label} must not contain custom properties`);
}

function isSharedArrayBuffer(value: object): boolean {
  return tryGetter(sharedArrayBufferByteLengthGetter, value).matched;
}

function inspectStaticValue(
  value: unknown,
  label: string,
  state: StaticInspectionState,
  depth: number,
): void {
  assertDepth(depth, label);
  if (typeof value === "string") {
    if (value.length > MAX_WORKFLOW_DEFINITION_TEXT_CODE_UNITS) {
      fail(`${label} string exceeds ${MAX_WORKFLOW_DEFINITION_TEXT_CODE_UNITS} code units`);
    }
    addBudget(state.budget, label, 1, value.length * 2);
    return;
  }
  if (
    value === null || value === undefined || typeof value === "boolean" ||
    typeof value === "number" || typeof value === "bigint"
  ) {
    addBudget(state.budget, label, 1, 8);
    return;
  }
  if (typeof value !== "object" || isProxyWithoutHooks(value)) {
    fail(`${label} must contain only non-Proxy structured-cloneable data`);
  }
  if (state.active.has(value)) fail(`${label} must not contain recursive references`);
  if (state.seen.has(value)) return;
  state.seen.add(value);
  state.active.add(value);
  addBudget(state.budget, label);

  try {
    if (Array.isArray(value)) {
      const entries = inspectDenseArrayValues(value, label);
      for (let index = 0; index < entries.length; index++) {
        inspectStaticValue(entries[index], `${label}[${index}]`, state, depth + 1);
      }
      return;
    }

    const date = (() => {
      try {
        return { matched: true, value: Date.prototype.getTime.call(value) };
      } catch {
        return { matched: false, value: 0 };
      }
    })();
    if (date.matched) {
      if (!Number.isFinite(date.value)) fail(`${label} must not contain an invalid Date`);
      assertNoOwnFields(value, label);
      addBudget(state.budget, label, 0, 8);
      return;
    }

    const mapSize = tryGetter(mapSizeGetter, value);
    if (mapSize.matched) {
      const size = mapSize.value;
      if (!Number.isSafeInteger(size) || (size as number) < 0) {
        fail(`${label} has invalid Map size`);
      }
      if ((size as number) > MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES) {
        fail(`${label} Map contains too many entries`);
      }
      assertNoOwnFields(value, label);
      const iterator = Reflect.apply(mapEntries, value, []) as IterableIterator<[
        unknown,
        unknown,
      ]>;
      let index = 0;
      while (true) {
        const next = Reflect.apply(mapIteratorNext, iterator, []) as IteratorResult<[
          unknown,
          unknown,
        ]>;
        if (next.done) break;
        inspectStaticValue(next.value[0], `${label} Map key ${index}`, state, depth + 1);
        inspectStaticValue(next.value[1], `${label} Map value ${index}`, state, depth + 1);
        index++;
      }
      return;
    }

    const setSize = tryGetter(setSizeGetter, value);
    if (setSize.matched) {
      const size = setSize.value;
      if (!Number.isSafeInteger(size) || (size as number) < 0) {
        fail(`${label} has invalid Set size`);
      }
      if ((size as number) > MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES) {
        fail(`${label} Set contains too many entries`);
      }
      assertNoOwnFields(value, label);
      const iterator = Reflect.apply(setValues, value, []) as IterableIterator<unknown>;
      let index = 0;
      while (true) {
        const next = Reflect.apply(setIteratorNext, iterator, []) as IteratorResult<unknown>;
        if (next.done) break;
        inspectStaticValue(next.value, `${label} Set value ${index}`, state, depth + 1);
        index++;
      }
      return;
    }

    if (isSharedArrayBuffer(value)) {
      fail(`${label} must not contain SharedArrayBuffer data`);
    }
    const arrayBufferLength = tryGetter(arrayBufferByteLengthGetter, value);
    if (arrayBufferLength.matched) {
      assertNoOwnFields(value, label);
      addBudget(state.budget, label, 0, arrayBufferLength.value as number);
      return;
    }

    const dataViewLength = tryGetter(dataViewByteLengthGetter, value);
    if (dataViewLength.matched) {
      assertNoOwnFields(value, label);
      const buffer = callGetter(dataViewBufferGetter, value) as object;
      if (isSharedArrayBuffer(buffer)) fail(`${label} must not view shared memory`);
      addBudget(state.budget, label, 0, dataViewLength.value as number);
      return;
    }

    const typedLength = tryGetter(typedArrayLengthGetter, value);
    if (typedLength.matched) {
      const length = typedLength.value as number;
      if (!Number.isSafeInteger(length) || length < 0) {
        fail(`${label} has invalid typed-array length`);
      }
      if (length > MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES) {
        fail(`${label} typed array contains too many entries`);
      }
      const byteLength = callGetter(typedArrayByteLengthGetter, value) as number;
      const buffer = callGetter(typedArrayBufferGetter, value) as object;
      if (isSharedArrayBuffer(buffer)) fail(`${label} must not view shared memory`);
      let keys: PropertyKey[];
      try {
        keys = Reflect.ownKeys(value);
      } catch (cause) {
        fail(`${label} could not be inspected`, cause);
      }
      if (keys.length !== length) fail(`${label} typed array must not contain custom properties`);
      for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor)) {
          fail(`${label} typed-array entry ${index} is not canonical`);
        }
      }
      addBudget(state.budget, label, 0, byteLength);
      return;
    }

    const regexp = tryGetter(regexpSourceGetter, value);
    if (regexp.matched) {
      const keys = Reflect.ownKeys(value);
      if (keys.length !== 1 || keys[0] !== "lastIndex") {
        fail(`${label} RegExp must not contain custom properties`);
      }
      const lastIndex = Object.getOwnPropertyDescriptor(value, "lastIndex");
      if (!lastIndex || !("value" in lastIndex) || lastIndex.value !== 0) {
        fail(`${label} RegExp lastIndex must be zero`);
      }
      addBudget(state.budget, label, 0, String(regexp.value).length * 2);
      return;
    }

    assertPlainStructuralRecord(value, label);
    let keys: PropertyKey[];
    try {
      keys = Reflect.ownKeys(value);
    } catch (cause) {
      fail(`${label} could not be inspected`, cause);
    }
    if (keys.length > MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES) {
      fail(`${label} record contains too many fields`);
    }
    for (const key of keys) {
      if (typeof key !== "string") fail(`${label} must not contain symbol keys`);
      if (key.length > MAX_WORKFLOW_DEFINITION_TEXT_CODE_UNITS) {
        fail(`${label} contains an overlong record key`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
        fail(`${label} field "${key}" must be an enumerable own data property`);
      }
      addBudget(state.budget, label, 0, key.length * 2);
      inspectStaticValue(descriptor.value, `${label}.${key}`, state, depth + 1);
    }
  } finally {
    state.active.delete(value);
  }
}

function freezeStaticSnapshot<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) freezeStaticSnapshot(entry, seen);
    return Object.freeze(value);
  }
  const mapSize = tryGetter(mapSizeGetter, value);
  if (mapSize.matched) {
    const iterator = Reflect.apply(mapEntries, value, []) as IterableIterator<[
      unknown,
      unknown,
    ]>;
    while (true) {
      const next = Reflect.apply(mapIteratorNext, iterator, []) as IteratorResult<[
        unknown,
        unknown,
      ]>;
      if (next.done) break;
      freezeStaticSnapshot(next.value[0], seen);
      freezeStaticSnapshot(next.value[1], seen);
    }
    return Object.freeze(value);
  }
  const setSize = tryGetter(setSizeGetter, value);
  if (setSize.matched) {
    const iterator = Reflect.apply(setValues, value, []) as IterableIterator<unknown>;
    while (true) {
      const next = Reflect.apply(setIteratorNext, iterator, []) as IteratorResult<unknown>;
      if (next.done) break;
      freezeStaticSnapshot(next.value, seen);
    }
    return Object.freeze(value);
  }
  if (tryGetter(typedArrayLengthGetter, value).matched) return value;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) freezeStaticSnapshot(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function captureStaticValueWithBudget<T>(
  value: T,
  label: string,
  budget: StaticBudget,
): T {
  inspectStaticValue(
    value,
    label,
    { active: new WeakSet(), seen: new WeakSet(), budget },
    0,
  );
  try {
    return freezeStaticSnapshot(structuredClone(value));
  } catch (cause) {
    fail(`${label} must contain only structured-cloneable values`, cause);
  }
}

/** Safely detach bounded persisted/declarative workflow data. @internal */
export function captureWorkflowStaticValue<T>(value: T, label: string): T {
  return captureStaticValueWithBudget(value, label, { bytes: 0, values: 0 });
}

/** Return a mutable per-consumer clone of an already-canonical static value. @internal */
export function cloneCapturedWorkflowStaticValue<T>(value: T, label: string): T {
  inspectStaticValue(
    value,
    label,
    { active: new WeakSet(), seen: new WeakSet(), budget: { bytes: 0, values: 0 } },
    0,
  );
  try {
    return structuredClone(value);
  } catch (cause) {
    fail(`${label} must contain only structured-cloneable values`, cause);
  }
}

export interface CaptureWorkflowStringListOptions {
  allowUndefined?: boolean;
  requireNonEmpty?: boolean;
}

/** Capture a dense, duplicate-free canonical string list. @internal */
export function captureWorkflowStringList(
  value: unknown,
  label: string,
  options: CaptureWorkflowStringListOptions = {},
): string[] | undefined {
  if (value === undefined && options.allowUndefined) return undefined;
  const entries = inspectDenseArrayValues(value, label);
  if (options.requireNonEmpty && entries.length === 0) fail(`${label} must not be empty`);
  const captured: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    assertString(entry, `${label} entry`, MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS, true);
    if (seen.has(entry)) fail(`${label} must not contain duplicate values`);
    seen.add(entry);
    captured.push(entry);
  }
  return Object.freeze(captured) as string[];
}

function captureRetryConfig(value: unknown, label: string): RetryConfig | undefined {
  if (value === undefined) return undefined;
  const fields = inspectExactRecord(value, `${label} retry`, RETRY_KEYS);
  const maxAttempts = fields.get("maxAttempts");
  const initialDelay = fields.get("initialDelay");
  const maxDelay = fields.get("maxDelay");
  const backoff = fields.get("backoff");
  if (maxAttempts !== undefined && typeof maxAttempts !== "number") {
    fail(`${label} retry maxAttempts must be a number`);
  }
  if (initialDelay !== undefined && typeof initialDelay !== "number") {
    fail(`${label} retry initialDelay must be a number`);
  }
  if (maxDelay !== undefined && typeof maxDelay !== "number") {
    fail(`${label} retry maxDelay must be a number`);
  }
  if (backoff !== undefined && typeof backoff !== "string") {
    fail(`${label} retry backoff must be a string`);
  }
  const retry = Object.freeze({
    ...(fields.has("maxAttempts") ? { maxAttempts } : {}),
    ...(fields.has("initialDelay") ? { initialDelay } : {}),
    ...(fields.has("maxDelay") ? { maxDelay } : {}),
    ...(fields.has("backoff") ? { backoff } : {}),
    ...(fields.has("retryIf") ? { retryIf: fields.get("retryIf") } : {}),
  }) as RetryConfig;
  assertOptionalFunction(retry.retryIf, `${label} retryIf`);
  validateRetryConfig(retry, `${label} retry`);
  return retry;
}

function captureDependencies(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  const captured = captureWorkflowStringList(value, `${label} dependsOn`) ?? [];
  for (const dependency of captured) assertNodeId(dependency, `${label} dependency`);
  return captured;
}

function captureCommonConfig(fields: ExactRecord, label: string) {
  const checkpoint = fields.get("checkpoint");
  if (checkpoint !== undefined && typeof checkpoint !== "boolean") {
    fail(`${label} checkpoint must be a boolean`);
  }
  const skip = fields.get("skip");
  assertOptionalFunction(skip, `${label} skip`);
  const timeout = fields.get("timeout");
  if (timeout !== undefined) assertDurationValue(timeout, `${label} timeout`, true);
  return {
    checkpoint: checkpoint as boolean | undefined,
    retry: captureRetryConfig(fields.get("retry"), label),
    timeout: timeout as string | number | undefined,
    skip: skip as WorkflowNodeConfig["skip"],
  };
}

function captureNodeConfig(
  value: unknown,
  label: string,
  state: CaptureState,
  depth: number,
): WorkflowNodeConfig {
  const typeFields = inspectExactRecord(
    value,
    `${label} config`,
    new Set(Object.values(CONFIG_KEYS).flatMap((keys) => [...keys])),
    ["type"],
  );
  const type = typeFields.get("type");
  if (typeof type !== "string" || !Object.hasOwn(CONFIG_KEYS, type)) {
    fail(`${label} has unsupported config type`);
  }
  const fields = inspectExactRecord(
    value,
    `${label} config`,
    CONFIG_KEYS[type as keyof typeof CONFIG_KEYS],
    ["type"],
  );
  const common = captureCommonConfig(fields, label);
  const staticValue = <T>(input: T, field: string): T =>
    captureStaticValueWithBudget(input, `${label} ${field}`, state.staticBudget);

  switch (type) {
    case "step": {
      const agent = fields.get("agent");
      const tool = fields.get("tool");
      if ((agent === undefined) === (tool === undefined)) {
        fail(`${label} step must configure exactly one of agent or tool`);
      }
      if (
        agent !== undefined && typeof agent !== "string" &&
        (typeof agent !== "object" || agent === null || isProxyWithoutHooks(agent))
      ) {
        fail(`${label} agent must be an ID or non-Proxy collaborator object`);
      }
      if (
        tool !== undefined && typeof tool !== "string" &&
        (typeof tool !== "object" || tool === null || isProxyWithoutHooks(tool))
      ) {
        fail(`${label} tool must be an ID or non-Proxy collaborator object`);
      }
      if (typeof agent === "string") {
        assertString(agent, `${label} agent ID`, MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS, true);
      }
      if (typeof tool === "string") {
        assertString(tool, `${label} tool ID`, MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS, true);
      }
      const input = fields.get("input");
      if (typeof input === "function") assertFunction(input, `${label} input builder`);
      return Object.freeze({
        type: "step" as const,
        ...common,
        agent,
        tool,
        input: typeof input === "function" || input === undefined
          ? input
          : staticValue(input, "input"),
      }) as WorkflowNodeConfig;
    }
    case "parallel": {
      const strategy = fields.get("strategy");
      if (strategy !== undefined && !["all", "race", "allSettled"].includes(strategy as string)) {
        fail(`${label} parallel strategy is invalid`);
      }
      return Object.freeze({
        type: "parallel" as const,
        ...common,
        strategy,
        nodes: captureNodeList(fields.get("nodes"), `${label} parallel children`, state, depth + 1),
      }) as WorkflowNodeConfig;
    }
    case "branch": {
      const condition = fields.get("condition");
      assertFunction(condition, `${label} branch condition`);
      return Object.freeze({
        type: "branch" as const,
        ...common,
        condition,
        then: captureNodeList(
          fields.get("then"),
          `${label} then branch`,
          state,
          depth + 1,
          true,
        ),
        else: fields.get("else") === undefined ? undefined : captureNodeList(
          fields.get("else"),
          `${label} else branch`,
          state,
          depth + 1,
          true,
        ),
      }) as WorkflowNodeConfig;
    }
    case "wait": {
      const waitType = fields.get("waitType");
      if (waitType !== "approval" && waitType !== "event") fail(`${label} waitType is invalid`);
      const message = fields.get("message");
      if (message !== undefined) assertString(message, `${label} message`);
      const eventName = fields.get("eventName");
      if (eventName !== undefined) {
        assertString(eventName, `${label} eventName`, MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS, true);
      }
      if (waitType === "event" && eventName === undefined) {
        fail(`${label} event wait requires eventName`);
      }
      const configuredWaitKind = fields.get(INTERNAL_WAIT_KIND_FIELD);
      if (
        configuredWaitKind !== undefined &&
        configuredWaitKind !== "delay" && configuredWaitKind !== "event"
      ) {
        fail(`${label} ${INTERNAL_WAIT_KIND_FIELD} is invalid`);
      }
      if (
        configuredWaitKind === "delay" &&
        (waitType !== "event" || eventName !== INTERNAL_DELAY_EVENT_NAME)
      ) {
        fail(`${label} delay marker requires the reserved delay event name`);
      }
      const payload = fields.get("payload");
      if (typeof payload === "function") assertFunction(payload, `${label} payload builder`);
      return Object.freeze({
        type: "wait" as const,
        ...common,
        waitType,
        message,
        payload: typeof payload === "function" || payload === undefined
          ? payload
          : staticValue(payload, "payload"),
        approvers: captureWorkflowStringList(fields.get("approvers"), `${label} approvers`, {
          allowUndefined: true,
          requireNonEmpty: true,
        }),
        eventName,
        ...(waitType === "event"
          ? {
            [INTERNAL_WAIT_KIND_FIELD]: configuredWaitKind === "delay" ? "delay" : "event",
          }
          : {}),
      }) as WorkflowNodeConfig;
    }
    case "subWorkflow": {
      const workflow = fields.get("workflow");
      if (typeof workflow !== "string" && (typeof workflow !== "object" || workflow === null)) {
        fail(`${label} sub-workflow must be an ID or definition`);
      }
      if (typeof workflow === "string") {
        assertString(
          workflow,
          `${label} sub-workflow ID`,
          MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS,
          true,
        );
      }
      const input = fields.get("input");
      const output = fields.get("output");
      assertOptionalFunction(output, `${label} output`);
      if (typeof input === "function") assertFunction(input, `${label} input builder`);
      return Object.freeze({
        type: "subWorkflow" as const,
        ...common,
        workflow: typeof workflow === "string"
          ? workflow
          : captureDefinition(workflow as WorkflowDefinition, state, depth + 1, true),
        input: typeof input === "function" || input === undefined
          ? input
          : staticValue(input, "input"),
        output,
      }) as WorkflowNodeConfig;
    }
    case "map": {
      const items = fields.get("items");
      if (items === undefined) fail(`${label} map items are required`);
      if (typeof items !== "function" && !Array.isArray(items)) {
        fail(`${label} map items must be an array or builder function`);
      }
      if (typeof items === "function") assertFunction(items, `${label} map items builder`);
      const processor = fields.get("processor");
      if (typeof processor !== "object" || processor === null || isProxyWithoutHooks(processor)) {
        fail(`${label} map processor must be a node or workflow definition`);
      }
      const processorFields = inspectExactRecord(
        processor,
        `${label} map processor`,
        new Set([...DEFINITION_KEYS, ...NODE_KEYS]),
      );
      const capturedProcessor = processorFields.has("steps")
        ? captureDefinition(processor as WorkflowDefinition, state, depth + 1, true)
        : captureNode(processor, `${label} processor`, state, depth + 1);
      const concurrency = fields.get("concurrency");
      if (
        concurrency !== undefined &&
        (!Number.isSafeInteger(concurrency) || (concurrency as number) < 1)
      ) {
        fail(`${label} map concurrency must be a positive safe integer`);
      }
      return Object.freeze({
        type: "map" as const,
        ...common,
        items: typeof items === "function" ? items : staticValue(items, "items"),
        processor: capturedProcessor,
        concurrency,
      }) as WorkflowNodeConfig;
    }
    case "loop": {
      const condition = fields.get("while");
      assertFunction(condition, `${label} loop while`);
      const steps = fields.get("steps");
      if (typeof steps !== "function" && !Array.isArray(steps)) {
        fail(`${label} loop steps must be an array or builder function`);
      }
      if (typeof steps === "function") assertFunction(steps, `${label} loop steps builder`);
      const maxIterations = fields.get("maxIterations");
      if (
        !Number.isSafeInteger(maxIterations) || (maxIterations as number) < 1 ||
        (maxIterations as number) > 100
      ) {
        fail(`${label} loop maxIterations must be an integer between 1 and 100`);
      }
      const onMaxIterations = fields.get("onMaxIterations");
      const onComplete = fields.get("onComplete");
      assertOptionalFunction(onMaxIterations, `${label} onMaxIterations`);
      assertOptionalFunction(onComplete, `${label} onComplete`);
      const iterationTimeout = fields.get("iterationTimeout");
      if (iterationTimeout !== undefined) {
        assertDurationValue(iterationTimeout, `${label} iterationTimeout`, true);
      }
      const delay = fields.get("delay");
      if (delay !== undefined) assertDurationValue(delay, `${label} delay`, false);
      return Object.freeze({
        type: "loop" as const,
        ...common,
        while: condition,
        steps: typeof steps === "function"
          ? steps
          : captureNodeList(steps, `${label} loop steps`, state, depth + 1, true),
        maxIterations,
        onMaxIterations,
        onComplete,
        iterationTimeout,
        delay,
      }) as WorkflowNodeConfig;
    }
  }
  return fail(`${label} has unsupported config type`);
}

function captureNode(
  value: unknown,
  label: string,
  state: CaptureState,
  depth: number,
): WorkflowNode {
  assertDepth(depth, label);
  const fields = inspectExactRecord(value, label, NODE_KEYS, ["id", "config"]);
  const id = fields.get("id");
  assertNodeId(id, `${label} ID`);

  state.nodeCount++;
  if (state.nodeCount > MAX_WORKFLOW_DEFINITION_NODES) {
    fail(`Workflow definition cannot contain more than ${MAX_WORKFLOW_DEFINITION_NODES} nodes`);
  }
  const object = value as object;
  if (state.activeNodes.has(object)) fail(`${label} contains a recursive node reference`);
  state.activeNodes.add(object);
  try {
    return Object.freeze({
      id,
      config: captureNodeConfig(fields.get("config"), label, state, depth),
      ...(fields.has("dependsOn")
        ? { dependsOn: captureDependencies(fields.get("dependsOn"), label) }
        : {}),
    });
  } finally {
    state.activeNodes.delete(object);
  }
}

function validateDependencyGraph(nodes: readonly WorkflowNode[], label: string): void {
  const byId = new Map<string, WorkflowNode>();
  const dependents = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const node of nodes) {
    if (byId.has(node.id)) fail(`${label} has duplicate node ID "${node.id}"`);
    byId.set(node.id, node);
    dependents.set(node.id, []);
    indegree.set(node.id, 0);
  }
  for (const node of nodes) {
    for (const dependency of node.dependsOn ?? []) {
      const targets = dependents.get(dependency);
      if (!targets) fail(`${label} node "${node.id}" depends on unknown node "${dependency}"`);
      targets.push(node.id);
      indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1);
    }
  }
  const queue: string[] = [];
  for (const [id, degree] of indegree) if (degree === 0) queue.push(id);
  let visited = 0;
  for (let index = 0; index < queue.length; index++) {
    visited++;
    for (const dependent of dependents.get(queue[index]!) ?? []) {
      const next = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, next);
      if (next === 0) queue.push(dependent);
    }
  }
  if (visited !== nodes.length) fail(`${label} contains a dependency cycle`);
}

function captureNodeList(
  value: unknown,
  label: string,
  state: CaptureState,
  depth: number,
  allowEmpty = false,
  emptyElementName: "node" | "step" = "node",
): WorkflowNode[] {
  assertDepth(depth, label);
  const values = inspectDenseArrayValues(value, label);
  if (!allowEmpty && values.length === 0) {
    fail(`${label} must have at least one ${emptyElementName}`);
  }
  const captured: WorkflowNode[] = [];
  for (let index = 0; index < values.length; index++) {
    captured.push(captureNode(values[index], `${label} node at index ${index}`, state, depth));
  }
  validateDependencyGraph(captured, label);
  return Object.freeze(captured) as WorkflowNode[];
}

function captureDefinition<TInput, TOutput>(
  value: unknown,
  state: CaptureState,
  depth: number,
  allowEmptySteps = false,
): WorkflowDefinition<TInput, TOutput> {
  assertDepth(depth, "Workflow definition");
  const fields = inspectExactRecord(value, "Workflow definition", DEFINITION_KEYS, ["id", "steps"]);
  const id = fields.get("id");
  assertString(id, "Workflow definition ID", MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS, true);
  const description = fields.get("description");
  if (description !== undefined) assertString(description, `Workflow "${id}" description`);
  const version = fields.get("version");
  if (version !== undefined) {
    assertString(version, `Workflow "${id}" version`, MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS, true);
  }
  const timeout = fields.get("timeout");
  if (timeout !== undefined) {
    assertDurationValue(timeout, `Workflow "${id}" timeout`, true);
  }
  const retry = captureRetryConfig(fields.get("retry"), `Workflow "${id}"`);
  const introspect = fields.get("introspect");
  if (introspect !== undefined && typeof introspect !== "boolean") {
    fail(`Workflow "${id}" introspect must be a boolean`);
  }
  const onError = fields.get("onError");
  const onComplete = fields.get("onComplete");
  assertOptionalFunction(onError, `Workflow "${id}" onError`);
  assertOptionalFunction(onComplete, `Workflow "${id}" onComplete`);
  const stepsValue = fields.get("steps");
  if (typeof stepsValue !== "function" && !Array.isArray(stepsValue)) {
    fail(`Workflow "${id}" steps must be an array or builder function`);
  }
  if (typeof stepsValue === "function") {
    assertFunction(stepsValue, `Workflow "${id}" steps builder`);
  }

  const object = value as object;
  if (state.activeDefinitions.has(object)) {
    fail(`Workflow "${id}" contains a recursive static definition reference`);
  }
  state.activeDefinitions.add(object);
  try {
    const steps = typeof stepsValue === "function" ? stepsValue : captureNodeList(
      stepsValue,
      `Workflow "${id}"`,
      state,
      depth + 1,
      allowEmptySteps,
      "step",
    );
    return Object.freeze({
      id,
      ...(fields.has("description") ? { description } : {}),
      ...(fields.has("version") ? { version } : {}),
      ...(fields.has("inputSchema") ? { inputSchema: fields.get("inputSchema") } : {}),
      ...(fields.has("outputSchema") ? { outputSchema: fields.get("outputSchema") } : {}),
      ...(fields.has("retry") ? { retry } : {}),
      ...(fields.has("timeout") ? { timeout } : {}),
      ...(fields.has("introspect") ? { introspect } : {}),
      steps,
      ...(fields.has("onError") ? { onError } : {}),
      ...(fields.has("onComplete") ? { onComplete } : {}),
    }) as WorkflowDefinition<TInput, TOutput>;
  } finally {
    state.activeDefinitions.delete(object);
  }
}

export interface CaptureWorkflowDefinitionOptions {
  /** Allow an empty declaration for discovery; executable admission remains strict by default. */
  allowEmptySteps?: boolean;
}

/** Validate and detach one workflow definition without constructing runtime resources. */
export function captureWorkflowDefinition<TInput = unknown, TOutput = unknown>(
  workflow: WorkflowDefinition<TInput, TOutput>,
  options: Readonly<CaptureWorkflowDefinitionOptions> = {},
): WorkflowDefinition<TInput, TOutput> {
  const fields = inspectExactRecord(
    options,
    "Workflow definition capture options",
    CAPTURE_DEFINITION_OPTION_KEYS,
  );
  const allowEmptySteps = fields.get("allowEmptySteps");
  if (allowEmptySteps !== undefined && typeof allowEmptySteps !== "boolean") {
    fail("Workflow definition capture option allowEmptySteps must be a boolean");
  }
  return captureDefinition<TInput, TOutput>(
    workflow,
    createCaptureState(),
    0,
    allowEmptySteps === true,
  );
}

/** Validate and detach a definition batch atomically, including duplicate IDs. */
export function captureWorkflowDefinitions(
  workflows: readonly WorkflowDefinition[],
): WorkflowDefinition[] {
  const values = inspectDenseArrayValues(workflows, "Workflow definitions");
  const state = createCaptureState();
  const captured: WorkflowDefinition[] = [];
  const seenIds = new Set<string>();
  for (const value of values) {
    const workflow = captureDefinition(value, state, 0);
    if (seenIds.has(workflow.id)) fail(`Workflow already registered in batch: ${workflow.id}`);
    seenIds.add(workflow.id);
    captured.push(workflow);
  }
  return Object.freeze(captured) as WorkflowDefinition[];
}

/** Capture nodes returned by a workflow or composite builder. */
export function captureWorkflowNodes(
  value: unknown,
  label: string,
  options: Readonly<{
    allowEmpty?: boolean;
    emptyElementName?: "node" | "step";
  }> = {},
): WorkflowNode[] {
  return captureNodeList(
    value,
    label,
    createCaptureState(),
    0,
    options.allowEmpty ?? false,
    options.emptyElementName ?? "node",
  );
}

/** Capture a dynamic map item array before identity expansion. */
export function captureWorkflowMapItems(value: unknown, label: string): unknown[] {
  const entries = inspectDenseArrayValues(value, label);
  const captured = captureWorkflowStaticValue(entries, label);
  return Object.freeze(captured) as unknown[];
}
