import type { Checkpoint, CheckpointResumeEnvelope, WorkflowContext } from "../types.ts";
import { nativeBrandChecks } from "#veryfront/platform/compat/native-brand-checks.ts";
import { serializeWorkflowJson } from "../context-serialization.ts";
import { MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES } from "../limits.ts";

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
const objectSetPrototypeOf = Object.setPrototypeOf;
const ProxyConstructor = Proxy;
const reflectApply = Reflect.apply;
const reflectGet = Reflect.get;
const reflectOwnKeys = Reflect.ownKeys;
const SetConstructor = Set;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const StringConstructor = String;
const structuredCloneValue = structuredClone;
const urlConstructor = typeof URL === "function" ? URL : undefined;
const urlHrefGet = urlConstructor
  ? objectGetOwnPropertyDescriptor(urlConstructor.prototype, "href")?.get
  : undefined;

type CheckpointCloneSource = object;

interface CheckpointCloneFrame {
  readonly arrayLength?: number;
  readonly arrayProxyLength?: number;
  readonly arrayPrototypeDiffers?: boolean;
  readonly jsonLookup?: CheckpointJsonLookup;
  readonly objectProxy?: boolean;
  readonly source: object;
  readonly target: object;
}

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

function isStructuredCloneRangeError(error: unknown): boolean {
  return error instanceof RangeError;
}

function cloneCheckpointJson<T>(value: T, label: string): T {
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

function toCheckpointArrayLength(value: unknown): number {
  const numeric = NumberConstructor(value);
  if (numberIsNaN(numeric) || numeric <= 0) return 0;
  if (!numberIsFinite(numeric)) return MAX_SAFE_INTEGER;
  return mathMin(mathFloor(numeric), MAX_SAFE_INTEGER);
}

function createCheckpointCloneTarget(
  value: CheckpointCloneSource,
  key: string,
  applyToJson: boolean,
): CheckpointCloneTarget {
  if (nativeBrandChecks?.isProxy(value) === true) {
    const jsonHook = applyToJson ? captureProxyJsonHook(value, key) : undefined;
    if (arrayIsArray(value)) {
      if (jsonHook) {
        return {
          jsonHook,
          target: new ProxyConstructor([], {}),
          traverseOwnProperties: false,
        };
      }
      const rawLength = reflectGet(value, "length");
      const proxyTarget: unknown[] = [];
      return {
        arrayProxyLength: toCheckpointArrayLength(rawLength),
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
  if (typeof value !== "object" || value === null) return value;

  const clones = new MapConstructor<object, object>();
  const clonesWithoutRootJson = new MapConstructor<object, object>();
  const activeJsonHookClones = new MapConstructor<object, object>();
  const keySensitiveJsonSources = new SetConstructor<object>();
  const frames: CheckpointCloneFrame[] = [];
  const cloneReference = (
    source: CheckpointCloneSource,
    key: string,
    applyToJson = true,
  ): object => {
    const activeJsonHookClone = reflectApply(mapGet, activeJsonHookClones, [source]) as
      | object
      | undefined;
    if (activeJsonHookClone) return activeJsonHookClone;
    const cloneMap = applyToJson ? clones : clonesWithoutRootJson;
    const existing = reflectApply(mapGet, cloneMap, [source]) as object | undefined;
    if (
      existing &&
      reflectApply(setHas, keySensitiveJsonSources, [source]) !== true
    ) return existing;
    const childTarget = createCheckpointCloneTarget(source, key, applyToJson);
    reflectApply(mapSet, cloneMap, [source, childTarget.target]);
    if (childTarget.jsonHook) {
      reflectApply(setAdd, keySensitiveJsonSources, [source]);
      reflectApply(mapSet, activeJsonHookClones, [source, childTarget.target]);
      const replacement = childTarget.jsonHook.replacement;
      const snapshot = typeof replacement === "object" && replacement !== null
        ? cloneReference(replacement, key, false)
        : replacement;
      const descriptor = childTarget.jsonHook.descriptor;
      objectDefineProperty(childTarget.target, "toJSON", {
        configurable: false,
        enumerable: descriptor.enumerable,
        value: () => snapshot,
        writable: "value" in descriptor ? descriptor.writable : false,
      });
      reflectApply(mapDelete, activeJsonHookClones, [source]);
    }
    if (
      childTarget.traverseOwnProperties ||
      childTarget.jsonHook?.replacement === source
    ) {
      reflectApply(arrayPush, frames, [{
        arrayLength: childTarget.arrayLength,
        arrayProxyLength: childTarget.arrayProxyLength,
        arrayPrototypeDiffers: childTarget.arrayPrototypeDiffers,
        jsonLookup: childTarget.jsonLookup,
        objectProxy: childTarget.objectProxy,
        source,
        target: childTarget.target,
      }]);
    }
    return childTarget.target;
  };
  const rootTarget = cloneReference(value, "");

  while (frames.length > 0) {
    const frame = reflectApply(arrayPop, frames, []) as CheckpointCloneFrame;
    if (frame.arrayProxyLength !== undefined) {
      for (let index = 0; index < frame.arrayProxyLength; index++) {
        const key = StringConstructor(index);
        const sourceValue = reflectGet(frame.source, key);
        const snapshot = typeof sourceValue === "object" && sourceValue !== null
          ? cloneReference(sourceValue, key)
          : sourceValue;
        objectDefineProperty(frame.target, key, {
          configurable: true,
          enumerable: true,
          value: snapshot,
          writable: true,
        });
      }
      continue;
    }
    let arrayPrototypeSnapshot: object | undefined;
    if (frame.arrayPrototypeDiffers === true) {
      const prototypeSnapshot = objectCreate(arrayPrototype);
      arrayPrototypeSnapshot = prototypeSnapshot;
      objectSetPrototypeOf(frame.target, prototypeSnapshot);
    }
    if (frame.arrayLength !== undefined) {
      for (let index = 0; index < frame.arrayLength; index++) {
        const key = StringConstructor(index);
        if (objectGetOwnPropertyDescriptor(frame.source, key) !== undefined) continue;
        if (arrayPrototypeSnapshot === undefined) {
          const prototypeSnapshot = objectCreate(arrayPrototype);
          arrayPrototypeSnapshot = prototypeSnapshot;
          objectSetPrototypeOf(frame.target, prototypeSnapshot);
        }
        const sourceValue = reflectGet(frame.source, key);
        const snapshot = typeof sourceValue === "object" && sourceValue !== null
          ? cloneReference(sourceValue, key)
          : sourceValue;
        objectDefineProperty(arrayPrototypeSnapshot, key, {
          configurable: true,
          enumerable: true,
          value: snapshot,
          writable: true,
        });
      }
    }
    const keys = reflectOwnKeys(frame.source);
    let jsonLookupInstalled = false;
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
      const key = keys[keyIndex]!;
      const descriptor = objectGetOwnPropertyDescriptor(frame.source, key);
      if (descriptor === undefined) continue;
      if (key === "toJSON" && frame.jsonLookup) {
        const lookup = frame.jsonLookup;
        const propertyValue = lookup.propertyValue;
        const propertySnapshot = typeof propertyValue === "object" && propertyValue !== null
          ? cloneReference(propertyValue, "toJSON")
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
        jsonLookupInstalled = true;
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
        const snapshot = typeof sourceValue === "object" && sourceValue !== null
          ? cloneReference(sourceValue, key)
          : sourceValue;
        objectDefineProperty(frame.target, key, {
          configurable: descriptor.configurable,
          enumerable: true,
          value: snapshot,
          writable: "value" in descriptor ? descriptor.writable : true,
        });
        continue;
      } else if ("value" in descriptor) {
        if (typeof descriptor.value === "object" && descriptor.value !== null) {
          descriptor.value = cloneReference(
            descriptor.value,
            typeof key === "string" ? key : "",
          );
        }
      } else if (
        typeof key === "string" && descriptor.enumerable === true &&
        typeof descriptor.get === "function"
      ) {
        const accessorValue = reflectGet(frame.source, key);
        const snapshot = typeof accessorValue === "object" && accessorValue !== null
          ? cloneReference(accessorValue, key)
          : accessorValue;
        descriptor.get = () => snapshot;
        descriptor.set = undefined;
      }
      objectDefineProperty(frame.target, key, descriptor);
    }
    if (frame.jsonLookup && !jsonLookupInstalled) {
      objectDefineProperty(frame.target, "toJSON", {
        configurable: false,
        enumerable: false,
        get: () => undefined,
      });
    }
    if (!objectIsExtensible(frame.source)) objectPreventExtensions(frame.target);
  }
  return rootTarget as T;
}

/** Snapshot original checkpoint values before an asynchronous backend boundary. */
export function cloneCheckpointForPersistence(checkpoint: Checkpoint): Checkpoint {
  return cloneCheckpointValueForPersistence(checkpoint);
}

export function cloneRetainedCheckpoint(checkpoint: Checkpoint): Checkpoint {
  const { context, nodeStates, _resumeEnvelope, ...checkpointMetadata } = checkpoint;
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
