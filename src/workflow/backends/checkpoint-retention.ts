import type { Checkpoint, CheckpointResumeEnvelope, WorkflowContext } from "../types.ts";
import { nativeBrandChecks } from "#veryfront/platform/compat/native-brand-checks.ts";
import {
  deferWorkflowJsonValue,
  isDeferredWorkflowJsonValue,
  MAX_TRAVERSAL_DEPTH,
  serializeWorkflowJson,
  stabilizeWorkflowJsonPrototypeSnapshot,
} from "../context-serialization.ts";
import { MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES } from "../limits.ts";
import { ORCHESTRATION_ERROR } from "#veryfront/errors";

const ArrayConstructor = Array;
const arrayIsArray = Array.isArray;
const arrayPop = Array.prototype.pop;
const arrayPrototype = Array.prototype;
const arrayPush = Array.prototype.push;
const mathFloor = Math.floor;
const mathMin = Math.min;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const NumberConstructor = Number;
const numberIsFinite = Number.isFinite;
const numberIsNaN = Number.isNaN;
const jsonParse = JSON.parse;
const jsonRawSupport = JSON as typeof JSON & {
  isRawJSON?: (value: unknown) => boolean;
  rawJSON?: (source: string) => object;
};
const jsonIsRawJSON = jsonRawSupport.isRawJSON;
const jsonRawJSON = jsonRawSupport.rawJSON;
const MapConstructor = Map;
const mapDelete = Map.prototype.delete;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectIsExtensible = Object.isExtensible;
const objectPreventExtensions = Object.preventExtensions;
const objectPrototype = Object.prototype;
const objectSetPrototypeOf = Object.setPrototypeOf;
const ProxyConstructor = Proxy;
const reflectApply = Reflect.apply;
const reflectGet = Reflect.get;
const reflectOwnKeys = Reflect.ownKeys;
const SetConstructor = Set;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const StringConstructor = String;
const symbolToPrimitive = Symbol.toPrimitive;
const structuredCloneValue = structuredClone;
const DateConstructor = Date;
const dateGetTime = Date.prototype.getTime;
const datePrototype = Date.prototype;
const dateToJSON = Date.prototype.toJSON;
const dateToISOString = Date.prototype.toISOString;
const urlConstructor = typeof URL === "function" ? URL : undefined;
const urlHrefGet = urlConstructor
  ? objectGetOwnPropertyDescriptor(urlConstructor.prototype, "href")?.get
  : undefined;
const MAX_PROXY_ARRAY_SNAPSHOT_LENGTH = 100_000;

type CheckpointCloneSource = object;

interface CheckpointCloneTraversalFrame {
  readonly arrayLength?: number;
  arrayIndex?: number;
  arrayIndicesDone?: boolean;
  arrayPrototypeSnapshot?: object;
  readonly arrayProxyLength?: number;
  readonly arrayPrototypeDiffers?: boolean;
  jsonLookupInstalled?: boolean;
  readonly jsonLookup?: CheckpointJsonLookup;
  readonly jsonHookDepth: number;
  keyIndex?: number;
  keys?: Array<string | symbol>;
  readonly objectProxy?: boolean;
  proxyDescriptors?: Array<PropertyDescriptor | undefined>;
  readonly source: object;
  readonly target: object;
}

interface CheckpointCloneExitFrame {
  readonly exitJsonHookSource: object;
}

type CheckpointCloneFrame = CheckpointCloneTraversalFrame | CheckpointCloneExitFrame;

interface CheckpointCloneTarget {
  readonly arrayLength?: number;
  readonly arrayProxyLength?: number;
  readonly arrayPrototypeDiffers?: boolean;
  readonly jsonHook?: CheckpointJsonHook;
  readonly jsonLookup?: CheckpointJsonLookup;
  readonly objectProxy?: boolean;
  readonly target: object;
  readonly traverseOwnProperties: boolean;
}

interface CheckpointJsonHook {
  readonly descriptor: PropertyDescriptor;
  readonly kind: "hook";
  readonly replacement: unknown;
}

interface CheckpointJsonLookup {
  readonly descriptor: PropertyDescriptor;
  readonly kind: "lookup";
  readonly propertyValue: unknown;
  readonly readsTwice: boolean;
}

type CheckpointJsonCapture = CheckpointJsonHook | CheckpointJsonLookup | false;
type OwnedCheckpointCloneSource = object;

interface OwnedCheckpointCloneFrame {
  keyIndex?: number;
  keys: Array<string | symbol>;
  readonly source: object;
  readonly target: object;
}

function isStructuredCloneRangeError(error: unknown): boolean {
  return error instanceof RangeError;
}

function isCheckpointCloneReference(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isArrayIndexWithinLength(key: string | symbol, length: number): boolean {
  if (typeof key !== "string") return false;
  const index = NumberConstructor(key);
  return numberIsFinite(index) && index >= 0 && mathFloor(index) === index &&
    index < length && StringConstructor(index) === key;
}

function cloneCheckpointJson<T>(value: T, label: string): T {
  if (isDeferredWorkflowJsonValue(value)) {
    return jsonParse(
      serializeWorkflowJson(value, label, undefined, { strictContext: false }),
    ) as T;
  }
  try {
    return structuredCloneValue(value);
  } catch (error) {
    if (!isStructuredCloneRangeError(error)) throw error;
  }
  return jsonParse(
    serializeWorkflowJson(value, label, undefined, { strictContext: false }),
  ) as T;
}

function cloneUrl(value: CheckpointCloneSource): URL | undefined {
  if (!urlConstructor || !urlHrefGet) return undefined;
  try {
    return new urlConstructor(reflectApply(urlHrefGet, value, []) as string);
  } catch {
    return undefined;
  }
}

function captureJsonHook(
  source: CheckpointCloneSource,
  key: string,
): CheckpointJsonCapture {
  const sourceDescriptor = objectGetOwnPropertyDescriptor(source, "toJSON");
  if (sourceDescriptor === undefined) {
    const hook = reflectGet(source, "toJSON");
    if (typeof hook === "function") {
      return {
        descriptor: {
          configurable: true,
          enumerable: false,
          value: hook,
          writable: true,
        },
        kind: "hook",
        replacement: reflectApply(hook, source, [key]),
      };
    }
    let prototype = objectGetPrototypeOf(source);
    while (prototype !== null) {
      if (objectGetOwnPropertyDescriptor(prototype, "toJSON") !== undefined) {
        return {
          descriptor: {
            configurable: true,
            enumerable: false,
            get: () => undefined,
          },
          kind: "lookup",
          propertyValue: undefined,
          readsTwice: false,
        };
      }
      prototype = objectGetPrototypeOf(prototype);
    }
    return false;
  }
  if ("value" in sourceDescriptor) {
    const hook = sourceDescriptor.value;
    if (typeof hook !== "function") return false;
    return {
      descriptor: sourceDescriptor,
      kind: "hook",
      replacement: reflectApply(hook, source, [key]),
    };
  }
  const hook = reflectGet(source, "toJSON");
  if (typeof hook !== "function") {
    return {
      descriptor: sourceDescriptor,
      kind: "lookup",
      propertyValue: sourceDescriptor.enumerable === true
        ? reflectGet(source, "toJSON")
        : undefined,
      readsTwice: sourceDescriptor.enumerable === true,
    };
  }
  return {
    descriptor: sourceDescriptor,
    kind: "hook",
    replacement: reflectApply(hook, source, [key]),
  };
}

function captureProxyJsonHook(
  source: CheckpointCloneSource,
  key: string,
): CheckpointJsonHook | undefined {
  const hook = reflectGet(source, "toJSON");
  if (typeof hook !== "function") return undefined;
  return {
    descriptor: {
      configurable: true,
      enumerable: false,
      value: hook,
      writable: true,
    },
    kind: "hook",
    replacement: reflectApply(hook, source, [key]),
  };
}

function captureCallableJsonHook(
  source: CheckpointCloneSource,
  key: string,
): CheckpointJsonHook | undefined {
  const hook = reflectGet(source, "toJSON");
  if (typeof hook !== "function") return undefined;
  const descriptor = objectGetOwnPropertyDescriptor(source, "toJSON");
  return {
    descriptor: descriptor ?? {
      configurable: true,
      enumerable: false,
      value: hook,
      writable: true,
    },
    kind: "hook",
    replacement: reflectApply(hook, source, [key]),
  };
}

function toCheckpointArrayLength(value: unknown): number {
  const numeric = NumberConstructor(value);
  if (numberIsNaN(numeric) || numeric <= 0) return 0;
  if (!numberIsFinite(numeric)) return MAX_SAFE_INTEGER;
  return mathMin(mathFloor(numeric), MAX_SAFE_INTEGER);
}

function oversizedProxyArraySentinel(length: number): object {
  const sentinel = objectCreate(null);
  objectDefineProperty(sentinel, "toJSON", {
    configurable: false,
    enumerable: false,
    value: () => {
      throw ORCHESTRATION_ERROR.create({
        detail:
          `Workflow run cannot be persisted: checkpoint contains a proxy array with ${length} ` +
          `indexed entries, which exceeds the stack-safe checkpoint snapshot limit of ` +
          `${MAX_PROXY_ARRAY_SNAPSHOT_LENGTH}.`,
      });
    },
    writable: false,
  });
  return sentinel;
}

function checkpointPersistenceSentinel(kind: string): object {
  const sentinel = objectCreate(null);
  objectDefineProperty(sentinel, "toJSON", {
    configurable: false,
    enumerable: false,
    value: () => {
      throw ORCHESTRATION_ERROR.create({
        detail: `Workflow run cannot be persisted: checkpoint contains ${kind}, which cannot be ` +
          `snapshotted before ownership fencing without executing user code.`,
      });
    },
    writable: false,
  });
  return sentinel;
}

function isDate(value: OwnedCheckpointCloneSource): boolean {
  try {
    reflectApply(dateGetTime, value, []);
    return true;
  } catch {
    return false;
  }
}

function cloneDate(value: OwnedCheckpointCloneSource): Date {
  const timestamp = reflectApply(dateGetTime, value, []) as number;
  const clone = new DateConstructor(timestamp);
  objectDefineProperty(clone, "toJSON", {
    configurable: false,
    enumerable: false,
    value: () => numberIsFinite(timestamp) ? reflectApply(dateToISOString, clone, []) : null,
    writable: false,
  });
  return clone;
}

function hasStableDatePrototype(value: OwnedCheckpointCloneSource): boolean {
  if (objectGetPrototypeOf(value) !== datePrototype) return false;
  const descriptor = objectGetOwnPropertyDescriptor(datePrototype, "toJSON");
  return descriptor !== undefined && "value" in descriptor && descriptor.value === dateToJSON;
}

function hasOwnDateSerializationOverride(value: OwnedCheckpointCloneSource): boolean {
  return objectGetOwnPropertyDescriptor(value, "toISOString") !== undefined ||
    objectGetOwnPropertyDescriptor(value, "valueOf") !== undefined ||
    objectGetOwnPropertyDescriptor(value, symbolToPrimitive) !== undefined;
}

function cloneRawJsonForOwnedCheckpoint(
  value: OwnedCheckpointCloneSource,
): OwnedCheckpointCloneSource | undefined {
  if (!jsonIsRawJSON || !jsonRawJSON || !reflectApply(jsonIsRawJSON, JSON, [value])) {
    return undefined;
  }
  const rawSource = objectGetOwnPropertyDescriptor(value, "rawJSON")?.value;
  return typeof rawSource === "string"
    ? reflectApply(jsonRawJSON, JSON, [rawSource]) as OwnedCheckpointCloneSource
    : checkpointPersistenceSentinel("a raw JSON value without an inspectable raw source");
}

function hasDynamicOwnToJson(value: OwnedCheckpointCloneSource): boolean {
  const descriptor = objectGetOwnPropertyDescriptor(value, "toJSON");
  return descriptor !== undefined &&
    (!("value" in descriptor) || typeof descriptor.value === "function");
}

function hasDynamicPrototypeToJson(value: OwnedCheckpointCloneSource): boolean {
  let prototype = objectGetPrototypeOf(value);
  while (prototype !== null) {
    const descriptor = objectGetOwnPropertyDescriptor(prototype, "toJSON");
    if (
      descriptor !== undefined &&
      (!("value" in descriptor) || typeof descriptor.value === "function")
    ) {
      return true;
    }
    prototype = objectGetPrototypeOf(prototype);
  }
  return false;
}

function cloneOwnedCheckpointValue<T>(value: T): T {
  if (typeof value === "function") {
    return deferWorkflowJsonValue(value) as T;
  }
  if (typeof value !== "object" || value === null) return value;
  if (nativeBrandChecks === undefined) {
    return deferWorkflowJsonValue(value) as T;
  }
  if (nativeBrandChecks.isProxy(value) === true) {
    return checkpointPersistenceSentinel("a Proxy value") as T;
  }
  if (hasDynamicOwnToJson(value)) {
    return deferWorkflowJsonValue(value) as T;
  }
  if (isDate(value)) {
    if (!hasStableDatePrototype(value)) {
      return deferWorkflowJsonValue(value) as T;
    }
    return (hasOwnDateSerializationOverride(value)
      ? deferWorkflowJsonValue(value)
      : cloneDate(value)) as T;
  }
  const rawJson = cloneRawJsonForOwnedCheckpoint(value);
  if (rawJson !== undefined) return rawJson as T;

  const brandChecks = nativeBrandChecks;
  const clones = new MapConstructor<object, object>();
  const frames: OwnedCheckpointCloneFrame[] = [];
  let deferRoot = false;
  const deferReference = (source: OwnedCheckpointCloneSource): object => {
    deferRoot = true;
    return deferWorkflowJsonValue(source);
  };
  const cloneReference = (source: OwnedCheckpointCloneSource): object => {
    const existing = reflectApply(mapGet, clones, [source]) as object | undefined;
    if (existing) return existing;
    if (brandChecks.isProxy(source) === true) {
      return checkpointPersistenceSentinel("a Proxy value");
    }
    const ownToJsonDescriptor = objectGetOwnPropertyDescriptor(source, "toJSON");
    if (
      ownToJsonDescriptor !== undefined &&
      (!("value" in ownToJsonDescriptor) || typeof ownToJsonDescriptor.value === "function")
    ) {
      return deferReference(source);
    }
    if (isDate(source)) {
      if (!hasStableDatePrototype(source)) {
        return deferReference(source);
      }
      return hasOwnDateSerializationOverride(source) ? deferReference(source) : cloneDate(source);
    }
    const rawJson = cloneRawJsonForOwnedCheckpoint(source);
    if (rawJson !== undefined) return rawJson;

    const isArray = arrayIsArray(source);
    const prototype = objectGetPrototypeOf(source);
    if (prototype !== null && brandChecks.isProxy(prototype) === true) {
      return checkpointPersistenceSentinel("a Proxy prototype");
    }
    if (
      isArray ? prototype !== arrayPrototype : prototype !== objectPrototype && prototype !== null
    ) {
      return deferReference(source);
    }
    if (
      ownToJsonDescriptor === undefined && prototype !== null &&
      hasDynamicPrototypeToJson(source)
    ) {
      return deferReference(source);
    }
    if (brandChecks.isNonPlainBuiltin(source) === true) {
      return deferReference(source);
    }
    const target = isArray
      ? ownToJsonDescriptor === undefined
        ? stabilizeWorkflowJsonPrototypeSnapshot(new ArrayConstructor(source.length))
        : new ArrayConstructor(source.length)
      : prototype === null
      ? objectCreate(null)
      : ownToJsonDescriptor === undefined
      ? stabilizeWorkflowJsonPrototypeSnapshot(objectCreate(objectPrototype))
      : objectCreate(objectPrototype);
    reflectApply(mapSet, clones, [source, target]);
    reflectApply(arrayPush, frames, [{
      keys: reflectOwnKeys(source),
      source,
      target,
    }]);
    return target;
  };
  const rootTarget = cloneReference(value);

  while (frames.length > 0) {
    const frame = frames[frames.length - 1]!;
    const index = frame.keyIndex ?? 0;
    if (index >= frame.keys.length) {
      if (!objectIsExtensible(frame.source)) objectPreventExtensions(frame.target);
      reflectApply(arrayPop, frames, []);
      continue;
    }
    frame.keyIndex = index + 1;
    const key = frame.keys[index]!;
    const descriptor = objectGetOwnPropertyDescriptor(frame.source, key);
    if (descriptor === undefined) continue;
    if (
      key !== "toJSON" &&
      (typeof key === "symbol" || descriptor.enumerable !== true) &&
      !(arrayIsArray(frame.source) && isArrayIndexWithinLength(key, frame.source.length))
    ) {
      objectDefineProperty(frame.target, key, descriptor);
      continue;
    }
    if (key === "toJSON") {
      if ("value" in descriptor && typeof descriptor.value !== "function") {
        const toJsonValue = descriptor.value;
        descriptor.value = typeof toJsonValue === "object" && toJsonValue !== null
          ? cloneReference(toJsonValue)
          : typeof toJsonValue === "function"
          ? checkpointPersistenceSentinel("a function")
          : toJsonValue;
        objectDefineProperty(frame.target, key, descriptor);
      } else {
        deferRoot = true;
      }
      continue;
    }
    if (!("value" in descriptor)) {
      deferRoot = true;
      continue;
    }
    const descriptorValue = descriptor.value;
    descriptor.value = typeof descriptorValue === "object" && descriptorValue !== null
      ? cloneReference(descriptorValue)
      : typeof descriptorValue === "function"
      ? deferReference(descriptorValue)
      : descriptorValue;
    objectDefineProperty(frame.target, key, descriptor);
  }

  return (deferRoot ? deferWorkflowJsonValue(value) : rootTarget) as T;
}

function cloneOwnedCheckpointWithoutNativeBrandChecks(checkpoint: Checkpoint): Checkpoint {
  const clone: Checkpoint = {
    id: checkpoint.id,
    nodeId: checkpoint.nodeId,
    timestamp: cloneDate(checkpoint.timestamp),
    context: deferWorkflowJsonValue(checkpoint.context) as WorkflowContext,
    nodeStates: deferWorkflowJsonValue(checkpoint.nodeStates) as Checkpoint["nodeStates"],
  };
  if (checkpoint._workflowProjection !== undefined) {
    clone._workflowProjection = deferWorkflowJsonValue(
      checkpoint._workflowProjection,
    ) as Checkpoint["_workflowProjection"];
  }
  if (checkpoint._resumeEnvelope !== undefined) {
    clone._resumeEnvelope = deferWorkflowJsonValue(
      checkpoint._resumeEnvelope,
    ) as CheckpointResumeEnvelope;
  }
  return clone;
}

function createCheckpointCloneTarget(
  value: CheckpointCloneSource,
  key: string,
  applyToJson: boolean,
): CheckpointCloneTarget {
  if (nativeBrandChecks?.isProxy(value) === true) {
    const jsonHook = applyToJson ? captureProxyJsonHook(value, key) : undefined;
    if (typeof value === "function") {
      return {
        ...(jsonHook ? { jsonHook } : {}),
        target: function checkpointCallableSnapshot() {},
        traverseOwnProperties: false,
      };
    }
    if (arrayIsArray(value)) {
      if (jsonHook) {
        return {
          jsonHook,
          target: new ProxyConstructor([], {}),
          traverseOwnProperties: false,
        };
      }
      const rawLength = reflectGet(value, "length");
      const arrayProxyLength = toCheckpointArrayLength(rawLength);
      if (arrayProxyLength > MAX_PROXY_ARRAY_SNAPSHOT_LENGTH) {
        return {
          target: oversizedProxyArraySentinel(arrayProxyLength),
          traverseOwnProperties: false,
        };
      }
      const proxyTarget: unknown[] = [];
      return {
        arrayProxyLength,
        target: new ProxyConstructor(proxyTarget, {
          get(target, key, receiver) {
            return key === "length" ? rawLength : reflectGet(target, key, receiver);
          },
        }),
        traverseOwnProperties: true,
      };
    }
    return {
      ...(jsonHook ? { jsonHook } : {}),
      objectProxy: jsonHook === undefined,
      target: new ProxyConstructor(objectCreate(null), {}),
      traverseOwnProperties: jsonHook === undefined,
    };
  }
  if (typeof value === "function") {
    const jsonHook = applyToJson ? captureCallableJsonHook(value, key) : undefined;
    return {
      ...(jsonHook ? { jsonHook } : {}),
      target: function checkpointCallableSnapshot() {},
      traverseOwnProperties: false,
    };
  }
  if (jsonIsRawJSON && jsonRawJSON && reflectApply(jsonIsRawJSON, JSON, [value])) {
    const rawSource = objectGetOwnPropertyDescriptor(value, "rawJSON")?.value;
    if (typeof rawSource === "string") {
      return {
        target: reflectApply(jsonRawJSON, JSON, [rawSource]) as object,
        traverseOwnProperties: false,
      };
    }
  }
  if (arrayIsArray(value)) {
    const target = new ArrayConstructor(value.length);
    const jsonCapture = applyToJson ? captureJsonHook(value, key) : false;
    const jsonHook = jsonCapture && jsonCapture.kind === "hook" ? jsonCapture : undefined;
    const jsonLookup = jsonCapture && jsonCapture.kind === "lookup" ? jsonCapture : undefined;
    return {
      ...(jsonHook ? { jsonHook } : {}),
      ...(jsonLookup ? { jsonLookup } : {}),
      arrayLength: value.length,
      arrayPrototypeDiffers: objectGetPrototypeOf(value) !== arrayPrototype,
      target,
      traverseOwnProperties: jsonHook === undefined,
    };
  }
  const clonedUrl = cloneUrl(value);
  if (clonedUrl) {
    const jsonCapture = applyToJson ? captureJsonHook(value, key) : false;
    const jsonHook = jsonCapture && jsonCapture.kind === "hook" ? jsonCapture : undefined;
    const jsonLookup = jsonCapture && jsonCapture.kind === "lookup" ? jsonCapture : undefined;
    return {
      ...(jsonHook ? { jsonHook } : {}),
      ...(jsonLookup ? { jsonLookup } : {}),
      target: clonedUrl,
      traverseOwnProperties: jsonHook === undefined,
    };
  }
  if (nativeBrandChecks?.isNonPlainBuiltin(value) === true) {
    try {
      const cloned = structuredCloneValue(value);
      if (
        typeof cloned === "object" && cloned !== null &&
        nativeBrandChecks.isNonPlainBuiltin(cloned)
      ) {
        const jsonCapture = applyToJson ? captureJsonHook(value, key) : false;
        const jsonHook = jsonCapture && jsonCapture.kind === "hook" ? jsonCapture : undefined;
        const jsonLookup = jsonCapture && jsonCapture.kind === "lookup" ? jsonCapture : undefined;
        return {
          ...(jsonHook ? { jsonHook } : {}),
          ...(jsonLookup ? { jsonLookup } : {}),
          target: cloned,
          traverseOwnProperties: jsonHook === undefined,
        };
      }
    } catch {
      // Some JSON-lossy native values are not structured-cloneable. Preserve
      // their rejection as a Proxy diagnostic while snapshotting the own data
      // that default JSON persistence can observe.
    }
    const jsonHook = captureProxyJsonHook(value, key);
    return {
      ...(jsonHook ? { jsonHook } : {}),
      objectProxy: jsonHook === undefined,
      target: new ProxyConstructor(objectCreate(null), {}),
      traverseOwnProperties: jsonHook === undefined,
    };
  }
  const target = objectCreate(objectGetPrototypeOf(value));
  const jsonCapture = applyToJson ? captureJsonHook(value, key) : false;
  const jsonHook = jsonCapture && jsonCapture.kind === "hook" ? jsonCapture : undefined;
  const jsonLookup = jsonCapture && jsonCapture.kind === "lookup" ? jsonCapture : undefined;
  return {
    ...(jsonHook ? { jsonHook } : {}),
    ...(jsonLookup ? { jsonLookup } : {}),
    target,
    traverseOwnProperties: jsonHook === undefined,
  };
}

function cloneCheckpointValueForPersistence<T>(value: T): T {
  if (nativeBrandChecks === undefined) return structuredCloneValue(value);
  if (!isCheckpointCloneReference(value)) return value;

  const clones = new MapConstructor<object, object>();
  const clonesWithoutRootJson = new MapConstructor<object, object>();
  const activeJsonHookClones = new MapConstructor<object, object>();
  const keySensitiveJsonSources = new SetConstructor<object>();
  const frames: CheckpointCloneFrame[] = [];
  const cloneReference = (
    source: CheckpointCloneSource,
    key: string,
    applyToJson = true,
    jsonHookDepth = 0,
  ): object => {
    const activeJsonHookClone = reflectApply(mapGet, activeJsonHookClones, [source]) as
      | object
      | undefined;
    const cloneMap = applyToJson ? clones : clonesWithoutRootJson;
    const existing = reflectApply(mapGet, cloneMap, [source]) as object | undefined;
    if (
      existing &&
      reflectApply(setHas, keySensitiveJsonSources, [source]) !== true
    ) return existing;
    const childTarget = createCheckpointCloneTarget(source, key, applyToJson);
    reflectApply(mapSet, cloneMap, [source, childTarget.target]);
    let traversesSelfReturningHook = false;
    if (childTarget.jsonHook) {
      if (jsonHookDepth >= MAX_TRAVERSAL_DEPTH) {
        throw ORCHESTRATION_ERROR.create({
          detail: `Workflow run cannot be persisted: checkpoint toJSON replacements exceed the ` +
            `stack-safe nesting limit of ${MAX_TRAVERSAL_DEPTH}.`,
        });
      }
      reflectApply(setAdd, keySensitiveJsonSources, [source]);
      const replacement = childTarget.jsonHook.replacement;
      traversesSelfReturningHook = replacement === source && typeof source !== "function" &&
        activeJsonHookClone === undefined;
      if (traversesSelfReturningHook) {
        reflectApply(mapSet, activeJsonHookClones, [source, childTarget.target]);
        reflectApply(arrayPush, frames, [{ exitJsonHookSource: source }]);
      }
      const snapshot = replacement === source
        ? activeJsonHookClone ?? childTarget.target
        : isCheckpointCloneReference(replacement)
        ? cloneReference(replacement, key, false, jsonHookDepth + 1)
        : replacement;
      const descriptor = childTarget.jsonHook.descriptor;
      objectDefineProperty(childTarget.target, "toJSON", {
        configurable: false,
        enumerable: descriptor.enumerable,
        value: () => snapshot,
        writable: "value" in descriptor ? descriptor.writable : false,
      });
    }
    if (
      childTarget.traverseOwnProperties ||
      traversesSelfReturningHook
    ) {
      reflectApply(arrayPush, frames, [{
        arrayLength: childTarget.arrayLength,
        arrayProxyLength: childTarget.arrayProxyLength,
        arrayPrototypeDiffers: childTarget.arrayPrototypeDiffers,
        jsonLookup: childTarget.jsonLookup,
        jsonHookDepth: childTarget.jsonHook ? jsonHookDepth + 1 : jsonHookDepth,
        objectProxy: childTarget.objectProxy,
        source,
        target: childTarget.target,
      }]);
    }
    return childTarget.target;
  };
  const rootTarget = cloneReference(value, "");

  while (frames.length > 0) {
    const frame = frames[frames.length - 1]!;
    if ("exitJsonHookSource" in frame) {
      reflectApply(mapDelete, activeJsonHookClones, [frame.exitJsonHookSource]);
      reflectApply(arrayPop, frames, []);
      continue;
    }
    if (frame.arrayProxyLength !== undefined) {
      const index = frame.arrayIndex ?? 0;
      if (index >= frame.arrayProxyLength) {
        reflectApply(arrayPop, frames, []);
        continue;
      }
      frame.arrayIndex = index + 1;
      const key = StringConstructor(index);
      const sourceValue = reflectGet(frame.source, key);
      const snapshot = isCheckpointCloneReference(sourceValue)
        ? cloneReference(sourceValue, key, true, frame.jsonHookDepth)
        : sourceValue;
      objectDefineProperty(frame.target, key, {
        configurable: true,
        enumerable: true,
        value: snapshot,
        writable: true,
      });
      continue;
    }
    if (frame.arrayLength !== undefined && frame.arrayIndicesDone !== true) {
      if (frame.arrayPrototypeDiffers === true && frame.arrayPrototypeSnapshot === undefined) {
        const prototypeSnapshot = objectCreate(arrayPrototype);
        frame.arrayPrototypeSnapshot = prototypeSnapshot;
        objectSetPrototypeOf(frame.target, prototypeSnapshot);
      }
      const index = frame.arrayIndex ?? 0;
      if (index >= frame.arrayLength) {
        frame.arrayIndicesDone = true;
      } else {
        frame.arrayIndex = index + 1;
        const key = StringConstructor(index);
        const ownDescriptor = objectGetOwnPropertyDescriptor(frame.source, key);
        if (ownDescriptor === undefined) {
          if (frame.arrayPrototypeSnapshot === undefined) {
            const prototypeSnapshot = objectCreate(arrayPrototype);
            frame.arrayPrototypeSnapshot = prototypeSnapshot;
            objectSetPrototypeOf(frame.target, prototypeSnapshot);
          }
          const sourceValue = reflectGet(frame.source, key);
          const snapshot = isCheckpointCloneReference(sourceValue)
            ? cloneReference(sourceValue, key, true, frame.jsonHookDepth)
            : sourceValue;
          objectDefineProperty(frame.arrayPrototypeSnapshot, key, {
            configurable: true,
            enumerable: true,
            value: snapshot,
            writable: true,
          });
        } else {
          const descriptor = ownDescriptor;
          if ("value" in descriptor) {
            if (isCheckpointCloneReference(descriptor.value)) {
              descriptor.value = cloneReference(
                descriptor.value,
                key,
                true,
                frame.jsonHookDepth,
              );
            }
          } else if (typeof descriptor.get === "function") {
            const accessorValue = reflectGet(frame.source, key);
            const snapshot = isCheckpointCloneReference(accessorValue)
              ? cloneReference(accessorValue, key, true, frame.jsonHookDepth)
              : accessorValue;
            descriptor.get = () => snapshot;
            descriptor.set = undefined;
          }
          objectDefineProperty(frame.target, key, descriptor);
        }
        continue;
      }
    }
    if (frame.keys === undefined) {
      frame.keyIndex = 0;
      frame.jsonLookupInstalled = false;
      if (frame.objectProxy === true) {
        const stringKeys: string[] = [];
        const descriptors: Array<PropertyDescriptor | undefined> = [];
        for (const key of reflectOwnKeys(frame.source)) {
          if (typeof key === "symbol") continue;
          reflectApply(arrayPush, stringKeys, [key]);
          reflectApply(arrayPush, descriptors, [objectGetOwnPropertyDescriptor(frame.source, key)]);
        }
        frame.keys = stringKeys;
        frame.proxyDescriptors = descriptors;
      } else {
        frame.keys = reflectOwnKeys(frame.source);
      }
    }
    if ((frame.keyIndex ?? 0) < frame.keys.length) {
      const keyIndex = frame.keyIndex ?? 0;
      const key = frame.keys[keyIndex]!;
      frame.keyIndex = keyIndex + 1;
      if (
        frame.arrayLength !== undefined &&
        isArrayIndexWithinLength(key, frame.arrayLength)
      ) {
        continue;
      }
      const descriptor = frame.objectProxy === true
        ? frame.proxyDescriptors?.[keyIndex]
        : objectGetOwnPropertyDescriptor(frame.source, key);
      if (descriptor === undefined) continue;
      if (
        key !== "toJSON" &&
        (typeof key === "symbol" || descriptor.enumerable !== true) &&
        !(frame.arrayLength !== undefined && isArrayIndexWithinLength(key, frame.arrayLength))
      ) {
        objectDefineProperty(frame.target, key, descriptor);
        continue;
      }
      if (key === "toJSON" && frame.jsonLookup) {
        const lookup = frame.jsonLookup;
        const propertyValue = lookup.propertyValue;
        const propertySnapshot = isCheckpointCloneReference(propertyValue)
          ? cloneReference(propertyValue, "toJSON", true, frame.jsonHookDepth)
          : propertyValue;
        let reads = 0;
        objectDefineProperty(frame.target, key, {
          configurable: false,
          enumerable: lookup.descriptor.enumerable,
          get: () => {
            const propertyRead = lookup.readsTwice && reads++ % 2 === 1;
            return propertyRead ? propertySnapshot : undefined;
          },
        });
        frame.jsonLookupInstalled = true;
        continue;
      }
      if (objectGetOwnPropertyDescriptor(frame.target, key)?.configurable === false) {
        if (arrayIsArray(frame.target) && key === "length") {
          objectDefineProperty(frame.target, key, descriptor);
        }
        continue;
      }
      if (
        frame.objectProxy === true && typeof key === "string" &&
        descriptor.enumerable === true
      ) {
        const sourceValue = reflectGet(frame.source, key);
        const snapshot = isCheckpointCloneReference(sourceValue)
          ? cloneReference(sourceValue, key, true, frame.jsonHookDepth)
          : sourceValue;
        objectDefineProperty(frame.target, key, {
          configurable: descriptor.configurable,
          enumerable: true,
          value: snapshot,
          writable: "value" in descriptor ? descriptor.writable : true,
        });
        continue;
      } else if ("value" in descriptor) {
        if (isCheckpointCloneReference(descriptor.value)) {
          descriptor.value = cloneReference(
            descriptor.value,
            typeof key === "string" ? key : "",
            true,
            frame.jsonHookDepth,
          );
        }
      } else if (
        typeof key === "string" && descriptor.enumerable === true &&
        typeof descriptor.get === "function"
      ) {
        const accessorValue = reflectGet(frame.source, key);
        const snapshot = isCheckpointCloneReference(accessorValue)
          ? cloneReference(accessorValue, key, true, frame.jsonHookDepth)
          : accessorValue;
        descriptor.get = () => snapshot;
        descriptor.set = undefined;
      }
      objectDefineProperty(frame.target, key, descriptor);
      continue;
    }
    if (frame.jsonLookup && frame.jsonLookupInstalled !== true) {
      objectDefineProperty(frame.target, "toJSON", {
        configurable: false,
        enumerable: false,
        get: () => undefined,
      });
    }
    if (
      nativeBrandChecks.isProxy(frame.source) !== true &&
      !objectIsExtensible(frame.source)
    ) {
      objectPreventExtensions(frame.target);
    }
    reflectApply(arrayPop, frames, []);
  }
  return rootTarget as T;
}

/** Snapshot original checkpoint values before an asynchronous backend boundary. */
export function cloneCheckpointForPersistence(checkpoint: Checkpoint): Checkpoint {
  return cloneCheckpointValueForPersistence(checkpoint);
}

export function cloneOwnedCheckpointForPersistence(checkpoint: Checkpoint): Checkpoint {
  if (nativeBrandChecks === undefined) {
    return cloneOwnedCheckpointWithoutNativeBrandChecks(checkpoint);
  }
  const clone: Checkpoint = {
    id: checkpoint.id,
    nodeId: checkpoint.nodeId,
    timestamp: cloneOwnedCheckpointValue(checkpoint.timestamp),
    context: cloneOwnedCheckpointValue(checkpoint.context),
    nodeStates: cloneOwnedCheckpointValue(checkpoint.nodeStates),
  };
  if (checkpoint._workflowProjection !== undefined) {
    clone._workflowProjection = cloneOwnedCheckpointValue(checkpoint._workflowProjection);
  }
  if (checkpoint._resumeEnvelope !== undefined) {
    clone._resumeEnvelope = cloneOwnedCheckpointValue(checkpoint._resumeEnvelope);
  }
  return clone;
}

export function cloneRetainedCheckpoint(checkpoint: Checkpoint): Checkpoint {
  const {
    context,
    nodeStates,
    _workflowProjection,
    _resumeEnvelope,
    ...checkpointMetadata
  } = checkpoint;
  const clone: Checkpoint = {
    ...structuredCloneValue(checkpointMetadata),
    context: cloneCheckpointJson<WorkflowContext>(context, "checkpoint.context"),
    nodeStates: cloneCheckpointJson<Checkpoint["nodeStates"]>(
      nodeStates,
      "checkpoint.nodeStates",
    ),
  };
  if (_resumeEnvelope !== undefined) {
    clone._resumeEnvelope = cloneCheckpointJson<CheckpointResumeEnvelope>(
      _resumeEnvelope,
      "checkpoint._resumeEnvelope",
    );
  }
  if (_workflowProjection !== undefined) {
    clone._workflowProjection = cloneCheckpointJson<NonNullable<Checkpoint["_workflowProjection"]>>(
      _workflowProjection,
      "checkpoint._workflowProjection",
    );
  }
  return clone;
}

/**
 * Append a detached checkpoint and retain only the newest bounded history.
 * Retention is strictly append-ordered and never inspects durable timestamps.
 */
export function appendRetainedCheckpoint(
  checkpoints: Checkpoint[],
  checkpoint: Checkpoint,
): void {
  const snapshot = cloneRetainedCheckpoint(checkpoint);
  checkpoints.push(snapshot);
  const excess = checkpoints.length - MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES;
  if (excess > 0) checkpoints.splice(0, excess);
}

/**
 * Return history after deleting one oldest occurrence for each requested ID.
 * Checkpoint IDs are not unique, so Set-based filtering would also delete
 * newer occurrences that cleanup intends to retain.
 */
export function deleteOldestCheckpointOccurrences(
  checkpoints: readonly Checkpoint[],
  checkpointIds: readonly string[],
): Checkpoint[] {
  const remainingById = new Map<string, number>();
  for (const id of checkpointIds) {
    remainingById.set(id, (remainingById.get(id) ?? 0) + 1);
  }

  return checkpoints.filter((checkpoint) => {
    const remaining = remainingById.get(checkpoint.id) ?? 0;
    if (remaining === 0) return true;
    if (remaining === 1) remainingById.delete(checkpoint.id);
    else remainingById.set(checkpoint.id, remaining - 1);
    return false;
  });
}
