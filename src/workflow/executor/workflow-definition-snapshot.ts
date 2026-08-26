import { INVALID_ARGUMENT } from "#veryfront/errors";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import type { ScheduleIntegrationRequirementConfig } from "#veryfront/schedule/types.ts";
import { captureScheduleIntegrationRequirementsConfig } from "#veryfront/schedule/validation.ts";
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

const arrayIsArray = Array.isArray;
const arrayIterator = Array.prototype[Symbol.iterator];
const dateGetTime = Date.prototype.getTime;
const MapConstructor = Map;
const mapForEach = Map.prototype.forEach;
const mapGet = Map.prototype.get;
const mapHas = Map.prototype.has;
const mapSet = Map.prototype.set;
const NativeSet = Set;
const NativeWeakSet = WeakSet;
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const objectDefineProperty = Object.defineProperty;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectHasOwn = Object.hasOwn;
const reflectApply = Reflect.apply;
const reflectOwnKeys = Reflect.ownKeys;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const StringConstructor = String;
const stringEndsWith = String.prototype.endsWith;
const stringTrim = String.prototype.trim;
const structuredCloneValue = structuredClone;
const weakSetAdd = WeakSet.prototype.add;
const weakSetDelete = WeakSet.prototype.delete;
const weakSetHas = WeakSet.prototype.has;

const structuredCloneTransferList: ArrayBuffer[] = [];
objectDefineProperty(structuredCloneTransferList, Symbol.iterator, {
  configurable: false,
  enumerable: false,
  value: arrayIterator,
  writable: false,
});
objectFreeze(structuredCloneTransferList);
const structuredCloneOptions = objectFreeze({ transfer: structuredCloneTransferList });

function appendArrayValue<T>(values: T[], value: T): void {
  objectDefineProperty(values, values.length, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function mapGetValue<K, V>(values: ReadonlyMap<K, V>, key: K): V | undefined {
  return reflectApply(mapGet, values, [key]);
}

function mapHasKey<K, V>(values: ReadonlyMap<K, V>, key: K): boolean {
  return reflectApply(mapHas, values, [key]) as boolean;
}

function mapSetValue<K, V>(values: Map<K, V>, key: K, value: V): void {
  reflectApply(mapSet, values, [key, value]);
}

function setHasValue<T>(values: ReadonlySet<T>, value: T): boolean {
  return reflectApply(setHas, values, [value]) as boolean;
}

function setAddValue<T>(values: Set<T>, value: T): void {
  reflectApply(setAdd, values, [value]);
}

function weakSetHasValue<T extends object>(values: WeakSet<T>, value: T): boolean {
  return reflectApply(weakSetHas, values, [value]) as boolean;
}

function weakSetAddValue<T extends object>(values: WeakSet<T>, value: T): void {
  reflectApply(weakSetAdd, values, [value]);
}

function weakSetDeleteValue<T extends object>(values: WeakSet<T>, value: T): void {
  reflectApply(weakSetDelete, values, [value]);
}

function hasDescriptorValue(
  descriptor: PropertyDescriptor,
): descriptor is PropertyDescriptor & { value: unknown } {
  return objectHasOwn(descriptor, "value");
}

const DEFINITION_KEYS = new Set([
  "id",
  "description",
  "version",
  "inputSchema",
  "outputSchema",
  "integrationRequirements",
  "retry",
  "timeout",
  "introspect",
  "steps",
  "onError",
  "onComplete",
]);
const CAPTURE_DEFINITION_OPTION_KEYS = new Set(["allowEmptySteps"]);
const CAPTURE_NODE_OPTION_KEYS = new Set(["allowEmpty", "emptyElementName"]);
const CAPTURE_STRING_LIST_OPTION_KEYS = new Set(["allowUndefined", "requireNonEmpty"]);
const NODE_KEYS = new Set(["id", "config", "dependsOn"]);
const RETRY_KEYS = new Set([
  "maxAttempts",
  "initialDelay",
  "maxDelay",
  "backoff",
  "retryIf",
]);
const COMMON_CONFIG_KEYS = [
  "type",
  "description",
  "checkpoint",
  "retry",
  "timeout",
  "skip",
] as const;
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
    "responseSchema",
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
const ALL_CONFIG_KEYS = new Set([
  ...CONFIG_KEYS.step,
  ...CONFIG_KEYS.parallel,
  ...CONFIG_KEYS.branch,
  ...CONFIG_KEYS.wait,
  ...CONFIG_KEYS.subWorkflow,
  ...CONFIG_KEYS.map,
  ...CONFIG_KEYS.loop,
]);
const MAP_PROCESSOR_KEYS = new Set([...DEFINITION_KEYS, ...NODE_KEYS]);
const PARALLEL_STRATEGIES = new Set(["all", "race", "allSettled"]);

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

interface ExactRecord {
  get(key: string): unknown;
  has(key: string): boolean;
}

function createCaptureState(): CaptureState {
  return {
    activeDefinitions: new NativeWeakSet(),
    activeNodes: new NativeWeakSet(),
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
    prototype = objectGetPrototypeOf(value) as object | null;
  } catch (cause) {
    fail(`${label} could not be inspected`, cause);
  }
  if (prototype === null) return;
  if (isProxyWithoutHooks(prototype)) fail(`${label} must not inherit from a Proxy`);
  let parent: object | null;
  try {
    parent = objectGetPrototypeOf(prototype) as object | null;
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
  if (arrayIsArray(value)) fail(`${label} must be a plain record`);
  assertPlainStructuralRecord(value, label);

  let keys: PropertyKey[];
  try {
    keys = reflectOwnKeys(value);
  } catch (cause) {
    fail(`${label} could not be inspected`, cause);
  }
  if (keys.length > MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES) {
    fail(`${label} contains too many fields`);
  }

  const fields = new MapConstructor<string, unknown>();
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    if (
      typeof key !== "string" ||
      !(reflectApply(setHas, allowedKeys, [key]) as boolean)
    ) {
      fail(
        `${label} contains unsupported field ${typeof key === "string" ? `"${key}"` : "symbol"}`,
      );
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = objectGetOwnPropertyDescriptor(value, key);
    } catch (cause) {
      fail(`${label} field "${key}" could not be inspected`, cause);
    }
    if (!descriptor || !hasDescriptorValue(descriptor)) {
      fail(`${label} field "${key}" must be an own data property`);
    }
    reflectApply(mapSet, fields, [key, descriptor.value]);
  }
  for (let index = 0; index < requiredKeys.length; index++) {
    const key = requiredKeys[index]!;
    if (!(reflectApply(mapHas, fields, [key]) as boolean)) {
      fail(`${label} must contain own data property "${key}"`);
    }
  }
  return {
    get(key: string): unknown {
      return reflectApply(mapGet, fields, [key]);
    },
    has(key: string): boolean {
      return reflectApply(mapHas, fields, [key]) as boolean;
    },
  };
}

function inspectDenseArrayValues(value: unknown, label: string): unknown[] {
  if (typeof value !== "object" || value === null || isProxyWithoutHooks(value)) {
    fail(`${label} must be a non-Proxy array`);
  }
  if (!arrayIsArray(value)) fail(`${label} must be an array`);

  let keys: PropertyKey[];
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    keys = reflectOwnKeys(value);
    lengthDescriptor = objectGetOwnPropertyDescriptor(value, "length");
  } catch (cause) {
    fail(`${label} could not be inspected`, cause);
  }
  const length = lengthDescriptor && hasDescriptorValue(lengthDescriptor)
    ? lengthDescriptor.value
    : undefined;
  if (!numberIsSafeInteger(length) || length < 0) fail(`${label} has an invalid length`);
  if (length > MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES) {
    fail(`${label} cannot contain more than ${MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES} entries`);
  }
  let unsupportedKey = false;
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    if (key !== "length" && typeof key !== "string") unsupportedKey = true;
  }
  if (keys.length !== length + 1 || unsupportedKey) {
    fail(`${label} must be dense and contain no custom properties`);
  }

  const values: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const key = StringConstructor(index);
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = objectGetOwnPropertyDescriptor(value, key);
    } catch (cause) {
      fail(`${label} entry ${index} could not be inspected`, cause);
    }
    if (!descriptor || !hasDescriptorValue(descriptor)) {
      fail(`${label} must be dense; entry ${index} is missing or is an accessor`);
    }
    objectDefineProperty(values, index, {
      value: descriptor.value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
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
    (requireCanonical &&
      (value.length === 0 || reflectApply(stringTrim, value, []) !== value))
  ) {
    fail(
      requireCanonical
        ? `${label} must be a canonical non-empty string of at most ${maxLength} code units`
        : `${label} must be a string of at most ${maxLength} code units`,
    );
  }
}

function captureIntegrationRequirements(
  value: unknown,
  workflowId: string,
): ScheduleIntegrationRequirementConfig[] | undefined {
  try {
    return captureScheduleIntegrationRequirementsConfig(value, "Workflow");
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid integration metadata";
    fail(`Workflow "${workflowId}" integrationRequirements is invalid: ${detail}`);
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
  if (
    setHasValue(RESERVED_CONTEXT_NODE_IDS, value) ||
    reflectApply(stringEndsWith, value, [LOOP_STATE_SUFFIX])
  ) {
    fail(`${label} uses reserved workflow context namespace "${value}"`);
  }
}

function callGetter(getter: ((this: unknown) => unknown) | undefined, value: object): unknown {
  if (!getter) return undefined;
  return reflectApply(getter, value, []);
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
    keys = reflectOwnKeys(value);
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
  if (weakSetHasValue(state.active, value)) fail(`${label} must not contain recursive references`);
  if (weakSetHasValue(state.seen, value)) return;
  weakSetAddValue(state.seen, value);
  weakSetAddValue(state.active, value);
  addBudget(state.budget, label);

  try {
    if (arrayIsArray(value)) {
      const entries = inspectDenseArrayValues(value, label);
      for (let index = 0; index < entries.length; index++) {
        inspectStaticValue(entries[index], `${label}[${index}]`, state, depth + 1);
      }
      return;
    }

    const date = (() => {
      try {
        return { matched: true, value: reflectApply(dateGetTime, value, []) };
      } catch {
        return { matched: false, value: 0 };
      }
    })();
    if (date.matched) {
      if (!numberIsFinite(date.value)) fail(`${label} must not contain an invalid Date`);
      assertNoOwnFields(value, label);
      addBudget(state.budget, label, 0, 8);
      return;
    }

    const mapSize = tryGetter(mapSizeGetter, value);
    if (mapSize.matched) {
      const size = mapSize.value;
      if (!numberIsSafeInteger(size) || (size as number) < 0) {
        fail(`${label} has invalid Map size`);
      }
      if ((size as number) > MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES) {
        fail(`${label} Map contains too many entries`);
      }
      assertNoOwnFields(value, label);
      const iterator = reflectApply(mapEntries, value, []) as IterableIterator<[
        unknown,
        unknown,
      ]>;
      let index = 0;
      while (true) {
        const next = reflectApply(mapIteratorNext, iterator, []) as IteratorResult<[
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
      if (!numberIsSafeInteger(size) || (size as number) < 0) {
        fail(`${label} has invalid Set size`);
      }
      if ((size as number) > MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES) {
        fail(`${label} Set contains too many entries`);
      }
      assertNoOwnFields(value, label);
      const iterator = reflectApply(setValues, value, []) as IterableIterator<unknown>;
      let index = 0;
      while (true) {
        const next = reflectApply(setIteratorNext, iterator, []) as IteratorResult<unknown>;
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
      if (!numberIsSafeInteger(length) || length < 0) {
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
        keys = reflectOwnKeys(value);
      } catch (cause) {
        fail(`${label} could not be inspected`, cause);
      }
      if (keys.length !== length) fail(`${label} typed array must not contain custom properties`);
      for (let index = 0; index < length; index++) {
        const descriptor = objectGetOwnPropertyDescriptor(value, StringConstructor(index));
        if (!descriptor || !hasDescriptorValue(descriptor)) {
          fail(`${label} typed-array entry ${index} is not canonical`);
        }
      }
      addBudget(state.budget, label, 0, byteLength);
      return;
    }

    const regexp = tryGetter(regexpSourceGetter, value);
    if (regexp.matched) {
      const keys = reflectOwnKeys(value);
      if (keys.length !== 1 || keys[0] !== "lastIndex") {
        fail(`${label} RegExp must not contain custom properties`);
      }
      const lastIndex = objectGetOwnPropertyDescriptor(value, "lastIndex");
      if (!lastIndex || !hasDescriptorValue(lastIndex) || lastIndex.value !== 0) {
        fail(`${label} RegExp lastIndex must be zero`);
      }
      addBudget(state.budget, label, 0, StringConstructor(regexp.value).length * 2);
      return;
    }

    assertPlainStructuralRecord(value, label);
    let keys: PropertyKey[];
    try {
      keys = reflectOwnKeys(value);
    } catch (cause) {
      fail(`${label} could not be inspected`, cause);
    }
    if (keys.length > MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES) {
      fail(`${label} record contains too many fields`);
    }
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index]!;
      if (typeof key !== "string") fail(`${label} must not contain symbol keys`);
      if (key.length > MAX_WORKFLOW_DEFINITION_TEXT_CODE_UNITS) {
        fail(`${label} contains an overlong record key`);
      }
      const descriptor = objectGetOwnPropertyDescriptor(value, key);
      if (!descriptor || !hasDescriptorValue(descriptor) || descriptor.enumerable !== true) {
        fail(`${label} field "${key}" must be an enumerable own data property`);
      }
      addBudget(state.budget, label, 0, key.length * 2);
      inspectStaticValue(descriptor.value, `${label}.${key}`, state, depth + 1);
    }
  } finally {
    weakSetDeleteValue(state.active, value);
  }
}

function freezeStaticSnapshot<T>(value: T, seen = new NativeWeakSet<object>()): T {
  if (typeof value !== "object" || value === null || weakSetHasValue(seen, value)) return value;
  weakSetAddValue(seen, value);
  if (arrayIsArray(value)) {
    for (let index = 0; index < value.length; index++) {
      freezeStaticSnapshot(value[index], seen);
    }
    return objectFreeze(value);
  }
  const mapSize = tryGetter(mapSizeGetter, value);
  if (mapSize.matched) {
    const iterator = reflectApply(mapEntries, value, []) as IterableIterator<[
      unknown,
      unknown,
    ]>;
    while (true) {
      const next = reflectApply(mapIteratorNext, iterator, []) as IteratorResult<[
        unknown,
        unknown,
      ]>;
      if (next.done) break;
      freezeStaticSnapshot(next.value[0], seen);
      freezeStaticSnapshot(next.value[1], seen);
    }
    return objectFreeze(value);
  }
  const setSize = tryGetter(setSizeGetter, value);
  if (setSize.matched) {
    const iterator = reflectApply(setValues, value, []) as IterableIterator<unknown>;
    while (true) {
      const next = reflectApply(setIteratorNext, iterator, []) as IteratorResult<unknown>;
      if (next.done) break;
      freezeStaticSnapshot(next.value, seen);
    }
    return objectFreeze(value);
  }
  if (tryGetter(typedArrayLengthGetter, value).matched) return value;
  const keys = reflectOwnKeys(value);
  for (let index = 0; index < keys.length; index++) {
    const descriptor = objectGetOwnPropertyDescriptor(value, keys[index]!);
    if (descriptor && hasDescriptorValue(descriptor)) {
      freezeStaticSnapshot(descriptor.value, seen);
    }
  }
  return objectFreeze(value);
}

function captureStaticValueWithBudget<T>(
  value: T,
  label: string,
  budget: StaticBudget,
): T {
  inspectStaticValue(
    value,
    label,
    { active: new NativeWeakSet(), seen: new NativeWeakSet(), budget },
    0,
  );
  try {
    return freezeStaticSnapshot(structuredCloneValue(value, structuredCloneOptions));
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
    {
      active: new NativeWeakSet(),
      seen: new NativeWeakSet(),
      budget: { bytes: 0, values: 0 },
    },
    0,
  );
  try {
    return structuredCloneValue(value, structuredCloneOptions);
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
  const optionFields = inspectExactRecord(
    options,
    `${label} capture options`,
    CAPTURE_STRING_LIST_OPTION_KEYS,
  );
  const allowUndefined = optionFields.get("allowUndefined");
  const requireNonEmpty = optionFields.get("requireNonEmpty");
  if (allowUndefined !== undefined && typeof allowUndefined !== "boolean") {
    fail(`${label} capture option allowUndefined must be a boolean`);
  }
  if (requireNonEmpty !== undefined && typeof requireNonEmpty !== "boolean") {
    fail(`${label} capture option requireNonEmpty must be a boolean`);
  }
  if (value === undefined && allowUndefined) return undefined;
  const entries = inspectDenseArrayValues(value, label);
  if (requireNonEmpty && entries.length === 0) fail(`${label} must not be empty`);
  const captured: string[] = [];
  const seen = new NativeSet<string>();
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    assertString(entry, `${label} entry`, MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS, true);
    if (setHasValue(seen, entry)) fail(`${label} must not contain duplicate values`);
    setAddValue(seen, entry);
    appendArrayValue(captured, entry);
  }
  return objectFreeze(captured) as string[];
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
  const retry = objectFreeze({
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
  for (let index = 0; index < captured.length; index++) {
    assertNodeId(captured[index], `${label} dependency`);
  }
  return captured;
}

function captureCommonConfig(fields: ExactRecord, label: string) {
  const description = fields.get("description");
  // Bounded like every other captured text field: a node description is
  // surfaced through workflow metadata and must not become an unbounded sink.
  if (description !== undefined) assertString(description, `${label} description`);
  const checkpoint = fields.get("checkpoint");
  if (checkpoint !== undefined && typeof checkpoint !== "boolean") {
    fail(`${label} checkpoint must be a boolean`);
  }
  const skip = fields.get("skip");
  assertOptionalFunction(skip, `${label} skip`);
  const timeout = fields.get("timeout");
  if (timeout !== undefined) assertDurationValue(timeout, `${label} timeout`, true);
  return {
    ...(description === undefined ? {} : { description: description as string }),
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
    ALL_CONFIG_KEYS,
    ["type"],
  );
  const type = typeFields.get("type");
  if (typeof type !== "string" || !objectHasOwn(CONFIG_KEYS, type)) {
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
      return objectFreeze({
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
      if (
        strategy !== undefined &&
        !setHasValue(PARALLEL_STRATEGIES, strategy as string)
      ) {
        fail(`${label} parallel strategy is invalid`);
      }
      return objectFreeze({
        type: "parallel" as const,
        ...common,
        strategy,
        nodes: captureNodeList(fields.get("nodes"), `${label} parallel children`, state, depth + 1),
      }) as WorkflowNodeConfig;
    }
    case "branch": {
      const condition = fields.get("condition");
      assertFunction(condition, `${label} branch condition`);
      return objectFreeze({
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
        waitType === "event" && eventName === INTERNAL_DELAY_EVENT_NAME &&
        configuredWaitKind !== "delay"
      ) {
        fail(`${label} reserved delay event name requires the delay marker`);
      }
      if (
        configuredWaitKind === "delay" &&
        (waitType !== "event" || eventName !== INTERNAL_DELAY_EVENT_NAME)
      ) {
        fail(`${label} delay marker requires the reserved delay event name`);
      }
      const payload = fields.get("payload");
      if (typeof payload === "function") assertFunction(payload, `${label} payload builder`);
      // Carried by reference, like a definition-level inputSchema: a schema is a
      // live object, not durable state, and is only consulted while the
      // definition that declared it is registered.
      const responseSchema = fields.get("responseSchema");
      if (
        responseSchema !== undefined &&
        (typeof responseSchema !== "object" || responseSchema === null ||
          typeof (responseSchema as { parse?: unknown }).parse !== "function")
      ) {
        fail(`${label} responseSchema must be a schema`);
      }
      return objectFreeze({
        type: "wait" as const,
        ...common,
        waitType,
        message,
        ...(responseSchema === undefined ? {} : { responseSchema }),
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
      return objectFreeze({
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
      if (typeof items !== "function" && !arrayIsArray(items)) {
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
        MAP_PROCESSOR_KEYS,
      );
      const capturedProcessor = processorFields.has("steps")
        ? captureDefinition(processor as WorkflowDefinition, state, depth + 1, true)
        : captureNode(processor, `${label} processor`, state, depth + 1);
      const concurrency = fields.get("concurrency");
      if (
        concurrency !== undefined &&
        (!numberIsSafeInteger(concurrency) || (concurrency as number) < 1)
      ) {
        fail(`${label} map concurrency must be a positive safe integer`);
      }
      return objectFreeze({
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
      if (typeof steps !== "function" && !arrayIsArray(steps)) {
        fail(`${label} loop steps must be an array or builder function`);
      }
      if (typeof steps === "function") assertFunction(steps, `${label} loop steps builder`);
      const maxIterations = fields.get("maxIterations");
      if (
        !numberIsSafeInteger(maxIterations) || (maxIterations as number) < 1 ||
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
      return objectFreeze({
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
  if (weakSetHasValue(state.activeNodes, object)) {
    fail(`${label} contains a recursive node reference`);
  }
  weakSetAddValue(state.activeNodes, object);
  try {
    return objectFreeze({
      id,
      config: captureNodeConfig(fields.get("config"), label, state, depth),
      ...(fields.has("dependsOn")
        ? { dependsOn: captureDependencies(fields.get("dependsOn"), label) }
        : {}),
    });
  } finally {
    weakSetDeleteValue(state.activeNodes, object);
  }
}

function validateDependencyGraph(nodes: readonly WorkflowNode[], label: string): void {
  const byId = new MapConstructor<string, WorkflowNode>();
  const dependents = new MapConstructor<string, string[]>();
  const indegree = new MapConstructor<string, number>();
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    if (mapHasKey(byId, node.id)) fail(`${label} has duplicate node ID "${node.id}"`);
    mapSetValue(byId, node.id, node);
    mapSetValue(dependents, node.id, []);
    mapSetValue(indegree, node.id, 0);
  }
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    const dependencies = objectHasOwn(node, "dependsOn") ? node.dependsOn ?? [] : [];
    for (let dependencyIndex = 0; dependencyIndex < dependencies.length; dependencyIndex++) {
      const dependency = dependencies[dependencyIndex]!;
      const targets = mapGetValue(dependents, dependency);
      if (!targets) fail(`${label} node "${node.id}" depends on unknown node "${dependency}"`);
      appendArrayValue(targets, node.id);
      mapSetValue(indegree, node.id, (mapGetValue(indegree, node.id) ?? 0) + 1);
    }
  }
  const queue: string[] = [];
  reflectApply(mapForEach, indegree, [
    (degree: number, id: string) => {
      if (degree === 0) appendArrayValue(queue, id);
    },
  ]);
  let visited = 0;
  for (let index = 0; index < queue.length; index++) {
    visited++;
    const currentDependents = mapGetValue(dependents, queue[index]!) ?? [];
    for (
      let dependentIndex = 0;
      dependentIndex < currentDependents.length;
      dependentIndex++
    ) {
      const dependent = currentDependents[dependentIndex]!;
      const next = (mapGetValue(indegree, dependent) ?? 0) - 1;
      mapSetValue(indegree, dependent, next);
      if (next === 0) appendArrayValue(queue, dependent);
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
    appendArrayValue(
      captured,
      captureNode(values[index], `${label} node at index ${index}`, state, depth),
    );
  }
  validateDependencyGraph(captured, label);
  return objectFreeze(captured) as WorkflowNode[];
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
  const integrationRequirements = captureIntegrationRequirements(
    fields.get("integrationRequirements"),
    id,
  );
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
  if (typeof stepsValue !== "function" && !arrayIsArray(stepsValue)) {
    fail(`Workflow "${id}" steps must be an array or builder function`);
  }
  if (typeof stepsValue === "function") {
    assertFunction(stepsValue, `Workflow "${id}" steps builder`);
  }

  const object = value as object;
  if (weakSetHasValue(state.activeDefinitions, object)) {
    fail(`Workflow "${id}" contains a recursive static definition reference`);
  }
  weakSetAddValue(state.activeDefinitions, object);
  try {
    const steps = typeof stepsValue === "function" ? stepsValue : captureNodeList(
      stepsValue,
      `Workflow "${id}"`,
      state,
      depth + 1,
      allowEmptySteps,
      "step",
    );
    return objectFreeze({
      id,
      ...(fields.has("description") ? { description } : {}),
      ...(fields.has("version") ? { version } : {}),
      ...(fields.has("inputSchema") ? { inputSchema: fields.get("inputSchema") } : {}),
      ...(fields.has("outputSchema") ? { outputSchema: fields.get("outputSchema") } : {}),
      ...(fields.has("integrationRequirements") ? { integrationRequirements } : {}),
      ...(fields.has("retry") ? { retry } : {}),
      ...(fields.has("timeout") ? { timeout } : {}),
      ...(fields.has("introspect") ? { introspect } : {}),
      steps,
      ...(fields.has("onError") ? { onError } : {}),
      ...(fields.has("onComplete") ? { onComplete } : {}),
    }) as WorkflowDefinition<TInput, TOutput>;
  } finally {
    weakSetDeleteValue(state.activeDefinitions, object);
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
  const seenIds = new NativeSet<string>();
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    const workflow = captureDefinition(value, state, 0);
    if (setHasValue(seenIds, workflow.id)) {
      fail(`Workflow already registered in batch: ${workflow.id}`);
    }
    setAddValue(seenIds, workflow.id);
    appendArrayValue(captured, workflow);
  }
  return objectFreeze(captured) as WorkflowDefinition[];
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
  const optionFields = inspectExactRecord(
    options,
    `${label} capture options`,
    CAPTURE_NODE_OPTION_KEYS,
  );
  const allowEmpty = optionFields.get("allowEmpty");
  const emptyElementName = optionFields.get("emptyElementName");
  if (allowEmpty !== undefined && typeof allowEmpty !== "boolean") {
    fail(`${label} capture option allowEmpty must be a boolean`);
  }
  if (
    emptyElementName !== undefined &&
    emptyElementName !== "node" && emptyElementName !== "step"
  ) {
    fail(`${label} capture option emptyElementName must be "node" or "step"`);
  }
  return captureNodeList(
    value,
    label,
    createCaptureState(),
    0,
    allowEmpty ?? false,
    emptyElementName ?? "node",
  );
}

/** Capture a dynamic map item array before identity expansion. */
export function captureWorkflowMapItems(value: unknown, label: string): unknown[] {
  const entries = inspectDenseArrayValues(value, label);
  const captured = captureWorkflowStaticValue(entries, label);
  return objectFreeze(captured) as unknown[];
}
