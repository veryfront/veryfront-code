import type { Checkpoint, CheckpointResumeEnvelope, WorkflowContext } from "../types.ts";
import { nativeBrandChecks } from "#veryfront/platform/compat/native-brand-checks.ts";
import {
  collectWorkflowJsonRecords,
  deferWorkflowJsonValue,
  isDeferredWorkflowJsonValue,
  MAX_TRAVERSAL_DEPTH,
  prepareNodeStatesUserData,
  serializeWorkflowJson,
  stabilizeWorkflowJsonPrototypeSnapshot,
  WORKFLOW_CHECKPOINT_RECORD,
  WORKFLOW_NODE_RECORD,
  WORKFLOW_RESUME_ENVELOPE_RECORD,
  workflowJsonFieldShape,
  type WorkflowJsonRecords,
  type WorkflowJsonRecordShape,
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
const weakMapGet = WeakMap.prototype.get;
const StringConstructor = String;
const symbolToPrimitive = Symbol.toPrimitive;
const structuredCloneValue = structuredClone;
const DateConstructor = Date;
const dateGetTime = Date.prototype.getTime;
const datePrototype = Date.prototype;
const dateToJSON = Date.prototype.toJSON;
const dateToISOString = Date.prototype.toISOString;
const DOMExceptionConstructor = typeof DOMException === "function" ? DOMException : undefined;
const urlConstructor = typeof URL === "function" ? URL : undefined;
const urlHrefGet = urlConstructor
  ? objectGetOwnPropertyDescriptor(urlConstructor.prototype, "href")?.get
  : undefined;
const WeakSetConstructor = WeakSet;
const weakSetAdd = WeakSet.prototype.add;
const weakSetHas = WeakSet.prototype.has;
const MAX_PROXY_ARRAY_SNAPSHOT_LENGTH = 100_000;
const checkpointJsonCloneRoots = new WeakSetConstructor<object>();

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
  ownPropertyDescriptors?: Array<PropertyDescriptor | undefined>;
  readonly objectProxy?: boolean;
  /** Set when the source is a framework record, such as a context keyed by node id. */
  readonly shape?: WorkflowJsonRecordShape;
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
  readonly shape?: WorkflowJsonRecordShape;
  readonly source: object;
  readonly target: object;
}

function isStructuredCloneRangeError(error: unknown): boolean {
  return error instanceof RangeError;
}

function isStructuredCloneDataError(error: unknown): boolean {
  return DOMExceptionConstructor !== undefined && error instanceof DOMExceptionConstructor &&
    error.name === "DataCloneError";
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

function cloneCheckpointJson<T>(
  value: T,
  label: string,
  shape?: WorkflowJsonRecordShape,
  records?: WorkflowJsonRecords,
  allowRecordDataCloneFallback = false,
): T {
  if (
    isDeferredWorkflowJsonValue(value) ||
    (typeof value === "object" && value !== null &&
      reflectApply(weakSetHas, checkpointJsonCloneRoots, [value]) === true)
  ) {
    return jsonParse(
      serializeWorkflowJson(value, label, undefined, { strictContext: false }, shape, records),
    ) as T;
  }
  try {
    return structuredCloneValue(value);
  } catch (error) {
    // Only a successfully persisted checkpoint may normalize shaped records
    // for its return value. Ordinary retention still rejects uncloneable data.
    // Rebuilt resume envelopes retain their existing JSON-boundary fallback.
    if (
      !isStructuredCloneRangeError(error) &&
      !((shape === WORKFLOW_RESUME_ENVELOPE_RECORD ||
        (allowRecordDataCloneFallback && shape !== undefined)) &&
        isStructuredCloneDataError(error))
    ) throw error;
  }
  return jsonParse(
    serializeWorkflowJson(value, label, undefined, { strictContext: false }, shape, records),
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

function createOwnedCheckpointCloneTarget(
  source: OwnedCheckpointCloneSource,
  isArray: boolean,
  prototype: CheckpointCloneSource | null,
  ownToJsonDescriptor: PropertyDescriptor | undefined,
): object {
  if (isArray) {
    return ownToJsonDescriptor === undefined
      ? stabilizeWorkflowJsonPrototypeSnapshot(new ArrayConstructor((source as unknown[]).length))
      : new ArrayConstructor((source as unknown[]).length);
  }
  if (prototype === null) return objectCreate(null);
  return ownToJsonDescriptor === undefined
    ? stabilizeWorkflowJsonPrototypeSnapshot(objectCreate(objectPrototype))
    : objectCreate(objectPrototype);
}

function cloneOwnedCheckpointDateReference(
  source: OwnedCheckpointCloneSource,
  deferReference: (source: OwnedCheckpointCloneSource) => object,
): object {
  if (!hasStableDatePrototype(source)) {
    return deferReference(source);
  }
  return hasOwnDateSerializationOverride(source) ? deferReference(source) : cloneDate(source);
}

function requiresDeferredOwnedCheckpointHook(
  sourceShape: WorkflowJsonRecordShape | undefined,
  descriptor: PropertyDescriptor | undefined,
): boolean {
  return sourceShape === undefined && descriptor !== undefined &&
    (!("value" in descriptor) || typeof descriptor.value === "function");
}

type OwnedCheckpointRootSnapshot =
  | { handled: true; value: unknown }
  | {
    handled: false;
    value: OwnedCheckpointCloneSource;
    brandChecks: NonNullable<typeof nativeBrandChecks>;
  };

function prepareOwnedCheckpointRoot(
  value: unknown,
  shape: WorkflowJsonRecordShape | undefined,
): OwnedCheckpointRootSnapshot {
  if (typeof value === "function") return { handled: true, value: deferWorkflowJsonValue(value) };
  if (typeof value !== "object" || value === null) return { handled: true, value };
  if (nativeBrandChecks === undefined) {
    return { handled: true, value: deferWorkflowJsonValue(value) };
  }
  if (nativeBrandChecks.isProxy(value) === true) {
    return { handled: true, value: checkpointPersistenceSentinel("a Proxy value") };
  }
  if (shape === undefined && hasDynamicOwnToJson(value)) {
    return { handled: true, value: deferWorkflowJsonValue(value) };
  }
  if (isDate(value)) {
    if (!hasStableDatePrototype(value)) {
      return { handled: true, value: deferWorkflowJsonValue(value) };
    }
    return {
      handled: true,
      value: hasOwnDateSerializationOverride(value)
        ? deferWorkflowJsonValue(value)
        : cloneDate(value),
    };
  }
  const rawJson = cloneRawJsonForOwnedCheckpoint(value);
  if (rawJson !== undefined) return { handled: true, value: rawJson };
  return { handled: false, value, brandChecks: nativeBrandChecks };
}

function cloneOwnedCheckpointValue<T>(
  value: T,
  shape?: WorkflowJsonRecordShape,
  sharedClones?: Map<object, object>,
): T {
  const prepared = prepareOwnedCheckpointRoot(value, shape);
  if (prepared.handled) return prepared.value as T;
  const brandChecks = prepared.brandChecks;
  const clones = sharedClones ?? new MapConstructor<object, object>();
  const addedSources: object[] = [];
  const frames: OwnedCheckpointCloneFrame[] = [];
  let deferRoot = false;
  let requiresJsonClone = false;
  const deferReference = (source: OwnedCheckpointCloneSource): object => {
    deferRoot = true;
    return deferWorkflowJsonValue(source);
  };
  const cloneReference = (
    source: OwnedCheckpointCloneSource,
    sourceShape?: WorkflowJsonRecordShape,
  ): object => {
    const existing = reflectApply(mapGet, clones, [source]) as object | undefined;
    if (existing) return existing;
    if (brandChecks.isProxy(source) === true) {
      return checkpointPersistenceSentinel("a Proxy value");
    }
    const ownToJsonDescriptor = objectGetOwnPropertyDescriptor(source, "toJSON");
    if (requiresDeferredOwnedCheckpointHook(sourceShape, ownToJsonDescriptor)) {
      return deferReference(source);
    }
    if (isDate(source)) {
      return cloneOwnedCheckpointDateReference(source, deferReference);
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
      sourceShape === undefined && ownToJsonDescriptor === undefined && prototype !== null &&
      hasDynamicPrototypeToJson(source)
    ) {
      return deferReference(source);
    }
    if (brandChecks.isNonPlainBuiltin(source) === true) {
      return deferReference(source);
    }
    const target = createOwnedCheckpointCloneTarget(
      source,
      isArray,
      prototype,
      ownToJsonDescriptor,
    );
    reflectApply(mapSet, clones, [source, target]);
    reflectApply(arrayPush, addedSources, [source]);
    reflectApply(arrayPush, frames, [{
      keys: reflectOwnKeys(source),
      shape: sourceShape,
      source,
      target,
    }]);
    return target;
  };
  const ownedToJsonPropertySnapshot = (value: unknown): unknown => {
    if (typeof value === "object" && value !== null) return cloneReference(value);
    if (typeof value === "function") return checkpointPersistenceSentinel("a function");
    return value;
  };

  const cloneOwnedDescriptorValue = (
    frame: OwnedCheckpointCloneFrame,
    key: string | symbol,
    descriptor: PropertyDescriptor,
  ): void => {
    const descriptorValue = descriptor.value;
    const childShape = workflowJsonFieldShape(frame.shape, key);
    if (typeof descriptorValue === "object" && descriptorValue !== null) {
      descriptor.value = cloneReference(descriptorValue, childShape);
    } else if (typeof descriptorValue === "function") {
      if (frame.shape !== undefined && key === "toJSON") {
        requiresJsonClone = true;
      } else {
        descriptor.value = deferReference(descriptorValue);
      }
    }
    objectDefineProperty(frame.target, key, descriptor);
  };

  const copyOwnedCheckpointProperty = (
    frame: OwnedCheckpointCloneFrame,
    key: string | symbol,
    descriptor: PropertyDescriptor,
  ): void => {
    if (
      key !== "toJSON" &&
      (typeof key === "symbol" || descriptor.enumerable !== true) &&
      !(arrayIsArray(frame.source) && isArrayIndexWithinLength(key, frame.source.length))
    ) {
      objectDefineProperty(frame.target, key, descriptor);
      return;
    }
    if (key === "toJSON" && frame.shape === undefined) {
      if ("value" in descriptor && typeof descriptor.value !== "function") {
        const toJsonValue = descriptor.value;
        descriptor.value = ownedToJsonPropertySnapshot(toJsonValue);
        objectDefineProperty(frame.target, key, descriptor);
      } else {
        deferRoot = true;
      }
      return;
    }
    if (!("value" in descriptor)) {
      deferRoot = true;
      return;
    }
    cloneOwnedDescriptorValue(frame, key, descriptor);
  };

  const finishOwnedCheckpointCloneFrame = (frame: OwnedCheckpointCloneFrame): void => {
    if (!objectIsExtensible(frame.source)) objectPreventExtensions(frame.target);
    reflectApply(arrayPop, frames, []);
  };

  const rootTarget = cloneReference(prepared.value, shape);

  while (frames.length > 0) {
    const frame = frames[frames.length - 1]!;
    const index = frame.keyIndex ?? 0;
    if (index >= frame.keys.length) {
      finishOwnedCheckpointCloneFrame(frame);
      continue;
    }
    frame.keyIndex = index + 1;
    const key = frame.keys[index]!;
    const descriptor = objectGetOwnPropertyDescriptor(frame.source, key);
    if (descriptor === undefined) continue;
    copyOwnedCheckpointProperty(frame, key, descriptor);
  }

  if (!deferRoot && requiresJsonClone) {
    reflectApply(weakSetAdd, checkpointJsonCloneRoots, [rootTarget]);
  }
  if (deferRoot && sharedClones !== undefined) {
    for (const source of addedSources) reflectApply(mapDelete, clones, [source]);
  }
  return (deferRoot ? deferWorkflowJsonValue(prepared.value) : rootTarget) as T;
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

function captureCheckpointTargetJson(
  value: CheckpointCloneSource,
  key: string,
  applyToJson: boolean,
): { jsonHook: CheckpointJsonHook | undefined; jsonLookup: CheckpointJsonLookup | undefined } {
  const jsonCapture = applyToJson ? captureJsonHook(value, key) : false;
  const jsonHook = jsonCapture && jsonCapture.kind === "hook" ? jsonCapture : undefined;
  const jsonLookup = jsonCapture && jsonCapture.kind === "lookup" ? jsonCapture : undefined;
  return { jsonHook, jsonLookup };
}

function createProxyCheckpointCloneTarget(
  value: CheckpointCloneSource,
  key: string,
  applyToJson: boolean,
): CheckpointCloneTarget {
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

function createBuiltinCheckpointCloneTarget(
  value: CheckpointCloneSource,
  key: string,
  applyToJson: boolean,
): CheckpointCloneTarget {
  try {
    const cloned = structuredCloneValue(value);
    if (
      typeof cloned === "object" && cloned !== null &&
      nativeBrandChecks!.isNonPlainBuiltin(cloned)
    ) {
      const { jsonHook, jsonLookup } = captureCheckpointTargetJson(value, key, applyToJson);
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

function createArrayCheckpointCloneTarget(
  value: unknown[],
  key: string,
  applyToJson: boolean,
): CheckpointCloneTarget {
  const target = new ArrayConstructor(value.length);
  const { jsonHook, jsonLookup } = captureCheckpointTargetJson(value, key, applyToJson);
  return {
    ...(jsonHook ? { jsonHook } : {}),
    ...(jsonLookup ? { jsonLookup } : {}),
    arrayLength: value.length,
    arrayPrototypeDiffers: objectGetPrototypeOf(value) !== arrayPrototype,
    target,
    traverseOwnProperties: jsonHook === undefined,
  };
}

function createCallableCheckpointCloneTarget(
  value: CheckpointCloneSource,
  key: string,
  applyToJson: boolean,
): CheckpointCloneTarget {
  const jsonHook = applyToJson ? captureCallableJsonHook(value, key) : undefined;
  return {
    ...(jsonHook ? { jsonHook } : {}),
    target: function checkpointCallableSnapshot() {},
    traverseOwnProperties: false,
  };
}

function createCheckpointCloneTarget(
  value: CheckpointCloneSource,
  key: string,
  applyToJson: boolean,
): CheckpointCloneTarget {
  if (nativeBrandChecks?.isProxy(value) === true) {
    return createProxyCheckpointCloneTarget(value, key, applyToJson);
  }
  if (typeof value === "function") {
    return createCallableCheckpointCloneTarget(value, key, applyToJson);
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
    return createArrayCheckpointCloneTarget(value, key, applyToJson);
  }
  const clonedUrl = cloneUrl(value);
  if (clonedUrl) {
    const { jsonHook, jsonLookup } = captureCheckpointTargetJson(value, key, applyToJson);
    return {
      ...(jsonHook ? { jsonHook } : {}),
      ...(jsonLookup ? { jsonLookup } : {}),
      target: clonedUrl,
      traverseOwnProperties: jsonHook === undefined,
    };
  }
  if (nativeBrandChecks?.isNonPlainBuiltin(value) === true) {
    return createBuiltinCheckpointCloneTarget(value, key, applyToJson);
  }
  const target = objectCreate(objectGetPrototypeOf(value));
  const { jsonHook, jsonLookup } = captureCheckpointTargetJson(value, key, applyToJson);
  return {
    ...(jsonHook ? { jsonHook } : {}),
    ...(jsonLookup ? { jsonLookup } : {}),
    target,
    traverseOwnProperties: jsonHook === undefined,
  };
}

function cloneCheckpointValueForPersistence<T>(value: T, rootShape?: WorkflowJsonRecordShape): T {
  if (nativeBrandChecks === undefined) return structuredCloneValue(value);
  if (!isCheckpointCloneReference(value)) return value;

  const clones = new MapConstructor<object, object>();
  const clonesWithoutRootJson = new MapConstructor<object, object>();
  const recordClones = new MapConstructor<object, object>();
  const activeJsonHookClones = new MapConstructor<object, object>();
  const keySensitiveJsonSources = new SetConstructor<object>();
  const frames: CheckpointCloneFrame[] = [];
  const records = rootShape === undefined
    ? undefined
    : collectWorkflowJsonRecords(value, rootShape);
  const selectCheckpointCloneMap = (
    shape: WorkflowJsonRecordShape | undefined,
    appliesToJson: boolean,
  ): Map<object, object> => {
    if (shape !== undefined) return recordClones;
    if (appliesToJson) return clones;
    return clonesWithoutRootJson;
  };

  const installCheckpointJsonHook = (
    childTarget: CheckpointCloneTarget,
    source: CheckpointCloneSource,
    key: string,
    jsonHookDepth: number,
    activeJsonHookClone: CheckpointCloneTarget["target"] | undefined,
  ): boolean => {
    let traversesSelfReturningHook = false;
    if (!childTarget.jsonHook) return traversesSelfReturningHook;
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
    let snapshot: unknown;
    if (replacement === source) snapshot = activeJsonHookClone ?? childTarget.target;
    else if (isCheckpointCloneReference(replacement)) {
      snapshot = cloneReference(replacement, key, false, jsonHookDepth + 1);
    } else snapshot = replacement;
    const descriptor = childTarget.jsonHook.descriptor;
    objectDefineProperty(childTarget.target, "toJSON", {
      configurable: false,
      enumerable: descriptor.enumerable,
      value: () => snapshot,
      writable: "value" in descriptor ? descriptor.writable : false,
    });
    return traversesSelfReturningHook;
  };

  const cloneReference = (
    source: CheckpointCloneSource,
    key: string,
    applyToJson = true,
    jsonHookDepth = 0,
    fieldShape?: WorkflowJsonRecordShape,
  ): object => {
    const activeJsonHookClone = reflectApply(mapGet, activeJsonHookClones, [source]) as
      | object
      | undefined;
    // A framework record's own keys are data, so it never has a `toJSON` hook.
    // A reference to a record from any other field, such as a node state that
    // holds the context, is that record and shares the record's snapshot.
    const shape = fieldShape ??
      (records === undefined
        ? undefined
        : reflectApply(weakMapGet, records, [source]) as WorkflowJsonRecordShape | undefined);
    const appliesToJson = applyToJson && shape === undefined;
    const cloneMap = selectCheckpointCloneMap(shape, appliesToJson);
    const existing = (reflectApply(mapGet, cloneMap, [source]) ??
      reflectApply(mapGet, recordClones, [source])) as object | undefined;
    if (
      existing &&
      reflectApply(setHas, keySensitiveJsonSources, [source]) !== true
    ) return existing;
    const childTarget = createCheckpointCloneTarget(source, key, appliesToJson);
    reflectApply(mapSet, cloneMap, [source, childTarget.target]);
    const traversesSelfReturningHook = installCheckpointJsonHook(
      childTarget,
      source,
      key,
      jsonHookDepth,
      activeJsonHookClone,
    );
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
        ...(shape === undefined ? {} : { shape }),
        source,
        target: childTarget.target,
      }]);
    }
    return childTarget.target;
  };
  const copyMissingCheckpointArrayIndex = (
    frame: CheckpointCloneTraversalFrame,
    key: string,
  ): void => {
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
  };

  const copyCheckpointArrayDescriptor = (
    frame: CheckpointCloneTraversalFrame,
    key: string,
    descriptor: PropertyDescriptor,
  ): void => {
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
  };

  const advanceCheckpointProxyArray = (frame: CheckpointCloneTraversalFrame): void => {
    const index = frame.arrayIndex ?? 0;
    if (index >= frame.arrayProxyLength!) {
      reflectApply(arrayPop, frames, []);
      return;
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
  };

  const advanceCheckpointArrayIndex = (frame: CheckpointCloneTraversalFrame): boolean => {
    if (frame.arrayPrototypeDiffers === true && frame.arrayPrototypeSnapshot === undefined) {
      const prototypeSnapshot = objectCreate(arrayPrototype);
      frame.arrayPrototypeSnapshot = prototypeSnapshot;
      objectSetPrototypeOf(frame.target, prototypeSnapshot);
    }
    const index = frame.arrayIndex ?? 0;
    if (index >= frame.arrayLength!) {
      frame.arrayIndicesDone = true;
    } else {
      frame.arrayIndex = index + 1;
      const key = StringConstructor(index);
      const ownDescriptor = objectGetOwnPropertyDescriptor(frame.source, key);
      if (ownDescriptor === undefined) {
        copyMissingCheckpointArrayIndex(frame, key);
      } else {
        copyCheckpointArrayDescriptor(frame, key, ownDescriptor);
      }
      return true;
    }
    return false;
  };

  const advanceCheckpointArrayFrame = (frame: CheckpointCloneTraversalFrame): boolean => {
    if (frame.arrayProxyLength !== undefined) {
      advanceCheckpointProxyArray(frame);
      return true;
    }
    if (frame.arrayLength !== undefined && frame.arrayIndicesDone !== true) {
      return advanceCheckpointArrayIndex(frame);
    }
    return false;
  };

  const initializeCheckpointFrameKeys = (frame: CheckpointCloneTraversalFrame): void => {
    frame.keys = reflectOwnKeys(frame.source);
    if (frame.objectProxy === true) {
      const descriptors = new ArrayConstructor<PropertyDescriptor | undefined>(
        frame.keys.length,
      );
      for (let index = 0; index < frame.keys.length; index++) {
        const key = frame.keys[index]!;
        if (typeof key === "string") {
          descriptors[index] = objectGetOwnPropertyDescriptor(frame.source, key);
        }
      }
      frame.ownPropertyDescriptors = descriptors;
    }
    frame.keyIndex = 0;
    frame.jsonLookupInstalled = false;
  };

  const copyCheckpointJsonLookup = (
    frame: CheckpointCloneTraversalFrame,
    key: string | symbol,
  ): boolean => {
    if (key !== "toJSON" || !frame.jsonLookup) return false;
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
    return true;
  };

  const copyFixedCheckpointProperty = (
    frame: CheckpointCloneTraversalFrame,
    key: string | symbol,
    descriptor: PropertyDescriptor,
  ): boolean => {
    if (objectGetOwnPropertyDescriptor(frame.target, key)?.configurable !== false) return false;
    if (arrayIsArray(frame.target) && key === "length") {
      objectDefineProperty(frame.target, key, descriptor);
    }
    return true;
  };

  const copyObjectProxyCheckpointProperty = (
    frame: CheckpointCloneTraversalFrame,
    key: string | symbol,
    descriptor: PropertyDescriptor,
  ): boolean => {
    if (frame.objectProxy !== true || typeof key !== "string" || descriptor.enumerable !== true) {
      return false;
    }
    const sourceValue = reflectGet(frame.source, key);
    const snapshot = isCheckpointCloneReference(sourceValue)
      ? cloneReference(
        sourceValue,
        key,
        true,
        frame.jsonHookDepth,
        workflowJsonFieldShape(frame.shape, key),
      )
      : sourceValue;
    objectDefineProperty(frame.target, key, {
      configurable: descriptor.configurable,
      enumerable: true,
      value: snapshot,
      writable: "value" in descriptor ? descriptor.writable : true,
    });
    return true;
  };

  const captureCheckpointDescriptorValue = (
    frame: CheckpointCloneTraversalFrame,
    key: string | symbol,
    descriptor: PropertyDescriptor,
  ): void => {
    if ("value" in descriptor) {
      if (isCheckpointCloneReference(descriptor.value)) {
        descriptor.value = cloneReference(
          descriptor.value,
          typeof key === "string" ? key : "",
          true,
          frame.jsonHookDepth,
          workflowJsonFieldShape(frame.shape, key),
        );
      }
    } else if (
      typeof key === "string" && descriptor.enumerable === true &&
      typeof descriptor.get === "function"
    ) {
      const accessorValue = reflectGet(frame.source, key);
      const snapshot = isCheckpointCloneReference(accessorValue)
        ? cloneReference(
          accessorValue,
          key,
          true,
          frame.jsonHookDepth,
          workflowJsonFieldShape(frame.shape, key),
        )
        : accessorValue;
      descriptor.get = () => snapshot;
      descriptor.set = undefined;
    }
  };

  const copyCheckpointProperty = (
    frame: CheckpointCloneTraversalFrame,
    key: string | symbol,
    descriptor: PropertyDescriptor,
  ): void => {
    if (
      key !== "toJSON" &&
      (typeof key === "symbol" || descriptor.enumerable !== true) &&
      !(frame.arrayLength !== undefined && isArrayIndexWithinLength(key, frame.arrayLength))
    ) {
      objectDefineProperty(frame.target, key, descriptor);
      return;
    }
    if (copyCheckpointJsonLookup(frame, key)) return;
    if (copyFixedCheckpointProperty(frame, key, descriptor)) return;
    if (copyObjectProxyCheckpointProperty(frame, key, descriptor)) return;
    captureCheckpointDescriptorValue(frame, key, descriptor);
    objectDefineProperty(frame.target, key, descriptor);
    if (
      key === "toJSON" && frame.shape !== undefined && "value" in descriptor &&
      typeof descriptor.value === "function"
    ) {
      reflectApply(weakSetAdd, checkpointJsonCloneRoots, [frame.target]);
    }
  };

  const finishCheckpointCloneFrame = (frame: CheckpointCloneTraversalFrame): void => {
    if (frame.jsonLookup && frame.jsonLookupInstalled !== true) {
      objectDefineProperty(frame.target, "toJSON", {
        configurable: false,
        enumerable: false,
        get: () => undefined,
      });
    }
    if (
      nativeBrandChecks!.isProxy(frame.source) !== true &&
      !objectIsExtensible(frame.source)
    ) {
      objectPreventExtensions(frame.target);
    }
    reflectApply(arrayPop, frames, []);
  };

  const advanceCheckpointObjectFrame = (frame: CheckpointCloneTraversalFrame): void => {
    if (frame.keys === undefined) {
      initializeCheckpointFrameKeys(frame);
    }
    if ((frame.keyIndex ?? 0) < frame.keys!.length) {
      const keyIndex = frame.keyIndex ?? 0;
      const key = frame.keys![keyIndex]!;
      frame.keyIndex = keyIndex + 1;
      if (
        frame.arrayLength !== undefined &&
        isArrayIndexWithinLength(key, frame.arrayLength)
      ) {
        return;
      }
      const descriptor = frame.ownPropertyDescriptors === undefined
        ? objectGetOwnPropertyDescriptor(frame.source, key)
        : frame.ownPropertyDescriptors[keyIndex];
      if (descriptor === undefined) return;
      copyCheckpointProperty(frame, key, descriptor);
      return;
    }
    finishCheckpointCloneFrame(frame);
  };

  const rootTarget = cloneReference(value, "", true, 0, rootShape);

  while (frames.length > 0) {
    const frame = frames[frames.length - 1]!;
    if ("exitJsonHookSource" in frame) {
      reflectApply(mapDelete, activeJsonHookClones, [frame.exitJsonHookSource]);
      reflectApply(arrayPop, frames, []);
      continue;
    }
    if (advanceCheckpointArrayFrame(frame)) continue;
    advanceCheckpointObjectFrame(frame);
  }
  return rootTarget as T;
}

/** Snapshot original checkpoint values before an asynchronous backend boundary. */
export function cloneCheckpointForPersistence(checkpoint: Checkpoint): Checkpoint {
  return cloneCheckpointValueForPersistence(checkpoint, WORKFLOW_CHECKPOINT_RECORD);
}

export function cloneOwnedCheckpointForPersistence(checkpoint: Checkpoint): Checkpoint {
  if (nativeBrandChecks === undefined) {
    return cloneOwnedCheckpointWithoutNativeBrandChecks(checkpoint);
  }
  const clones = new MapConstructor<object, object>();
  const clone: Checkpoint = {
    id: checkpoint.id,
    nodeId: checkpoint.nodeId,
    timestamp: cloneOwnedCheckpointValue(checkpoint.timestamp, undefined, clones),
    context: cloneOwnedCheckpointValue(checkpoint.context, WORKFLOW_NODE_RECORD, clones),
    nodeStates: cloneOwnedCheckpointValue(checkpoint.nodeStates, WORKFLOW_NODE_RECORD, clones),
  };
  if (checkpoint._workflowProjection !== undefined) {
    clone._workflowProjection = cloneOwnedCheckpointValue(
      checkpoint._workflowProjection,
      undefined,
      clones,
    );
  }
  if (checkpoint._resumeEnvelope !== undefined) {
    clone._resumeEnvelope = cloneOwnedCheckpointValue(
      checkpoint._resumeEnvelope,
      WORKFLOW_RESUME_ENVELOPE_RECORD,
      clones,
    );
  }
  return clone;
}

/**
 * `records` defaults to the records of `checkpoint`. A caller that has already
 * replaced a field passes the records of the original checkpoint, so a
 * reference to the original record from another field is still a record.
 */
export function cloneRetainedCheckpoint(
  checkpoint: Checkpoint,
  records: WorkflowJsonRecords = collectWorkflowJsonRecords(
    checkpoint,
    WORKFLOW_CHECKPOINT_RECORD,
  ),
  options: { allowRecordDataCloneFallback?: boolean } = {},
): Checkpoint {
  const {
    context,
    nodeStates,
    _workflowProjection,
    _resumeEnvelope,
    ...checkpointMetadata
  } = checkpoint;
  const clone: Checkpoint = {
    ...structuredCloneValue(checkpointMetadata),
    context: cloneCheckpointJson<WorkflowContext>(
      context,
      "checkpoint.context",
      WORKFLOW_NODE_RECORD,
      records,
      options.allowRecordDataCloneFallback,
    ),
    nodeStates: cloneCheckpointJson<Checkpoint["nodeStates"]>(
      options.allowRecordDataCloneFallback
        ? prepareNodeStatesUserData(nodeStates, undefined, { strictContext: false }, records)
        : nodeStates,
      "checkpoint.nodeStates",
      WORKFLOW_NODE_RECORD,
      records,
      options.allowRecordDataCloneFallback,
    ),
  };
  if (_resumeEnvelope !== undefined) {
    clone._resumeEnvelope = cloneCheckpointJson<CheckpointResumeEnvelope>(
      _resumeEnvelope,
      "checkpoint._resumeEnvelope",
      WORKFLOW_RESUME_ENVELOPE_RECORD,
      records,
      options.allowRecordDataCloneFallback,
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
  records?: WorkflowJsonRecords,
): void {
  const snapshot = cloneRetainedCheckpoint(checkpoint, records);
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
