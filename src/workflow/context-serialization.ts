import { ORCHESTRATION_ERROR } from "#veryfront/errors";
import {
  canIdentifyProxyWithoutHooks,
  isProxyWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";
import { agentLogger } from "#veryfront/utils";
import type { WorkflowContext } from "./types.ts";

const logger = agentLogger.component("workflow-context");
const arrayIsArray = Array.isArray;
const arrayPrototype = Array.prototype;
const BigIntValueOf = BigInt.prototype.valueOf;
const BooleanValueOf = Boolean.prototype.valueOf;
const dateGetTime = Date.prototype.getTime;
const ErrorConstructor = Error as typeof Error & {
  isError?: (value: unknown) => boolean;
};
const errorIsError = typeof ErrorConstructor.isError === "function"
  ? ErrorConstructor.isError
  : undefined;
const jsonIsRawJSON = typeof (JSON as JsonRawSupport).isRawJSON === "function"
  ? (JSON as JsonRawSupport).isRawJSON
  : undefined;
const jsonParse = JSON.parse;
const jsonRawJSON = typeof (JSON as JsonRawSupport).rawJSON === "function"
  ? (JSON as JsonRawSupport).rawJSON
  : undefined;
const jsonStringify = JSON.stringify;
const mathFloor = Math.floor;
const mathMin = Math.min;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const numberIsFinite = Number.isFinite;
const numberIsNaN = Number.isNaN;
const NumberValueOf = Number.prototype.valueOf;
const ObjectConstructor = Object;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const objectGetPrototypeOf = Object.getPrototypeOf;
const mapSizeGet = objectGetOwnPropertyDescriptor(Map.prototype, "size")?.get;
const objectHasOwn = Object.hasOwn;
const objectIs = Object.is;
const objectIsExtensible = Object.isExtensible;
const objectKeys = Object.keys;
const objectPrototype = Object.prototype;
const objectToString = Object.prototype.toString;
const POSITIVE_INFINITY = Number.POSITIVE_INFINITY;
const reflectApply = Reflect.apply;
const reflectGet = Reflect.get;
const reflectOwnKeys = Reflect.ownKeys;
const regExpSourceGet = objectGetOwnPropertyDescriptor(RegExp.prototype, "source")?.get;
const SetConstructor = Set;
const setSizeGet = objectGetOwnPropertyDescriptor(Set.prototype, "size")?.get;
const setAdd = Set.prototype.add;
const setDelete = Set.prototype.delete;
const setHas = Set.prototype.has;
const StringConstructor = String;
const stringSlice = String.prototype.slice;
const StringValueOf = String.prototype.valueOf;
const symbolToStringTag = Symbol.toStringTag;
const typedArrayPrototype = objectGetPrototypeOf(Uint8Array.prototype);
const typedArrayByteLengthGet = objectGetOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
const arrayBufferByteLengthGet = objectGetOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;
const dataViewByteLengthGet = objectGetOwnPropertyDescriptor(
  DataView.prototype,
  "byteLength",
)?.get;
const WeakMapConstructor = WeakMap;
const weakMapGet = WeakMap.prototype.get;
const weakMapSet = WeakMap.prototype.set;

function defineArrayElement<T>(values: T[], index: number, value: T): void {
  objectDefineProperty(values, index, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

/** How many paths a diagnostic names before it stops enumerating. */
const MAX_REPORTED_PATHS = 5;

/**
 * @internal How deep the walk descends before handing the value back to JSON.
 *
 * This walk recurses and `JSON.stringify` does not, so a value nested a few
 * thousand levels deep exhausts the stack here while JSON encodes it without
 * complaint. Failing such a run with `Maximum call stack size exceeded` raised
 * from inside the backend is the outcome this module exists to remove, so past
 * this depth the diagnostic is dropped rather than the run: the value is
 * encoded the way the backend encoded it before this check existed.
 */
export const MAX_TRAVERSAL_DEPTH = 1000;

/**
 * Redact runtime property names before placing them in a diagnostic.
 *
 * A path is built from the keys a step chose, and a step is free to key an
 * object by an email address, an account id, or any other payload value. The
 * diagnostic is flattened into a single string before it reaches the logger,
 * where key-based redaction can no longer see the structure -- so an
 * unrecognised key would travel into logs and persisted error details as
 * ordinary message text.
 *
 * Only the fixed WorkflowContext root fields are structural. Every other
 * object key may be payload data, even when it looks like an identifier.
 */
function redactPathSegment(key: string, trustContextRoot = false): string {
  return trustContextRoot && (key === "input" || key === "step") ? key : "<redacted>";
}

/** A value the durable codec cannot carry, named by where it sits. */
interface UnrepresentableValue {
  readonly path: string;
  readonly kind: string;
}

/**
 * What one walk found, split by how JSON fails the value.
 *
 * JSON fails a value in two ways: it refuses to encode it at all -- a BigInt, a
 * cycle -- or it encodes something lesser, like a Date becoming a string or a
 * Map becoming `{}`. The first fails the run, the second changes what a later
 * step reads, so they warrant different responses.
 *
 * Each side keeps at most `MAX_REPORTED_PATHS` paths and counts the rest. A
 * step is free to return an array with half a million holes, and every hole is
 * a diagnostic no message will ever show, so holding one entry per hole would
 * spend memory proportional to the payload on the persistence path. The counts
 * stay exact, so a message still says how many there were.
 */
interface UnrepresentableValues {
  readonly fatal: UnrepresentableValue[];
  readonly lossy: UnrepresentableValue[];
  fatalCount: number;
  lossyCount: number;
}

/** Object identity tracked while JSON.stringify walks the active value graph. */
type JsonTraversalReference = object;

interface NormalizedJsonObject {
  [key: string]: NormalizedJsonValue;
}

export interface WorkflowJsonSerializationOptions {
  /**
   * Promote JSON-lossy values such as Date, Map, undefined, and NaN from
   * warnings to persistence errors.
   */
  strictContext?: boolean;
}

interface RawJsonValue {
  readonly rawJSON: string;
}

interface JsonRawSupport {
  isRawJSON?(value: unknown): value is RawJsonValue;
  rawJSON?(source: string): RawJsonValue;
}

const jsonRawSupport = JSON as typeof JSON & JsonRawSupport;

type NormalizedJsonValue =
  | null
  | boolean
  | number
  | string
  | NormalizedJsonValue[]
  | NormalizedJsonObject
  | RawJsonValue;

const OMIT_JSON_VALUE = Symbol("omit-json-value");
const ACTIVE_JSON_TAIL_REFERENCE = new Error("active JSON tail reference");
const BIGINT_JSON_TAIL_VALUE = new Error("BigInt JSON tail value");

/** Encode an uninspected tail now, preserving native hook order and output. */
function normalizeJsonTail(
  value: JsonTraversalReference,
  key: string,
  active: Set<JsonTraversalReference>,
): NormalizedJsonValue | typeof OMIT_JSON_VALUE {
  const holder = objectCreate(null);
  objectDefineProperty(holder, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  const parents = new WeakMapConstructor<JsonTraversalReference, JsonTraversalReference>();
  const hasAncestor = (
    holder: JsonTraversalReference,
    candidate: JsonTraversalReference,
  ): boolean => {
    let ancestor: JsonTraversalReference | undefined = holder;
    while (ancestor !== undefined) {
      if (ancestor === candidate) return true;
      ancestor = reflectApply(weakMapGet, parents, [ancestor]) as
        | JsonTraversalReference
        | undefined;
    }
    return false;
  };
  const serializedHolder = jsonStringify(holder, function (
    this: JsonTraversalReference,
    _key,
    nested,
  ) {
    if (typeof nested === "bigint") throw BIGINT_JSON_TAIL_VALUE;
    if (nested !== null && typeof nested === "object") {
      if (reflectApply(setHas, active, [nested])) throw ACTIVE_JSON_TAIL_REFERENCE;
      if (hasAncestor(this, nested)) throw ACTIVE_JSON_TAIL_REFERENCE;
      reflectApply(weakMapSet, parents, [nested, this]);
    }
    return nested;
  });
  if (serializedHolder === "{}") return OMIT_JSON_VALUE;

  const encodedKey = jsonStringify(key)!;
  const prefixLength = encodedKey.length + 2;
  const serializedValue = reflectApply(stringSlice, serializedHolder!, [prefixLength, -1]);
  return jsonParse(
    serializedValue,
    (_key, parsed, context?: { source?: string }) => {
      if (context?.source === undefined || jsonRawJSON === undefined) return parsed;
      return reflectApply(jsonRawJSON, jsonRawSupport, [context.source]);
    },
  ) as NormalizedJsonValue;
}

function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "bigint") return "BigInt";
  if (typeof value === "function") return "function";
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "number") return numberIsFinite(value) ? "number" : `number (${value})`;
  return "object";
}

function hasNativeSlot(
  value: JsonTraversalReference,
  getter: ((this: unknown) => unknown) | undefined,
): boolean {
  if (getter === undefined) return false;
  try {
    reflectApply(getter, value, []);
    return true;
  } catch {
    return false;
  }
}

function hasNativeBrand(
  value: JsonTraversalReference,
  predicate: ((value: unknown) => boolean) | undefined,
  receiver: unknown,
): boolean {
  if (predicate === undefined) return false;
  try {
    return reflectApply(predicate, receiver, [value]) === true;
  } catch {
    return false;
  }
}

function isKnownNonPlainBuiltin(value: JsonTraversalReference): boolean {
  return hasNativeSlot(value, dateGetTime) ||
    hasNativeBrand(value, errorIsError, ErrorConstructor) ||
    hasNativeSlot(value, mapSizeGet) ||
    hasNativeSlot(value, setSizeGet) ||
    hasNativeSlot(value, regExpSourceGet) ||
    hasNativeSlot(value, typedArrayByteLengthGet) ||
    hasNativeSlot(value, arrayBufferByteLengthGet) ||
    hasNativeSlot(value, dataViewByteLengthGet);
}

/** Whether a value is a plain `{}` object rather than a class instance. */
function isPlainObject(
  value: JsonTraversalReference,
  inspectPrototype: boolean,
): boolean {
  // Default persistence keeps diagnostic-only prototype traps untouched on
  // edge-style hosts. Strict persistence opts into the metadata read because
  // accepting an ordinary class instance would violate its unchanged-value
  // contract. A throwing trap fails the strict check closed below.
  if (!canIdentifyProxyWithoutHooks && !inspectPrototype) return true;
  if (canIdentifyProxyWithoutHooks && isProxyWithoutHooks(value)) return false;
  try {
    const prototype = objectGetPrototypeOf(value);
    return prototype === objectPrototype ||
      (!inspectPrototype && prototype === null);
  } catch {
    return false;
  }
}

function describeToJsonValue(value: unknown): string {
  if (typeof value === "bigint") return "BigInt";
  if (typeof value === "object") {
    try {
      reflectApply(dateGetTime, value, []);
      return "Date";
    } catch {
      // The value is not a Date.
    }
  }
  return "toJSON value";
}

function toJsonLength(value: unknown): number {
  // Unary plus uses the specification's ToNumber operation, which rejects a
  // BigInt directly or returned by an object's primitive conversion.
  const number = +(value as number);
  if (numberIsNaN(number) || number <= 0) return 0;
  if (number === POSITIVE_INFINITY) return MAX_SAFE_INTEGER;
  return mathMin(mathFloor(number), MAX_SAFE_INTEGER);
}

function isSerializedArrayIndexKey(key: string, length: number): boolean {
  const index = +key;
  return numberIsFinite(index) &&
    index >= 0 &&
    index < length &&
    mathFloor(index) === index &&
    StringConstructor(index) === key;
}

function hasToStringTagWithoutHooks(value: JsonTraversalReference): boolean {
  if (!canIdentifyProxyWithoutHooks) return false;
  let current: object | null = value;
  for (let depth = 0; current !== null && depth < 100; depth++) {
    if (isProxyWithoutHooks(current)) return true;
    try {
      if (objectGetOwnPropertyDescriptor(current, symbolToStringTag)) return true;
      current = objectGetPrototypeOf(current);
    } catch {
      return true;
    }
  }
  return current !== null;
}

/**
 * Whether a value could hold a primitive slot, judging only unspoofed tags.
 *
 * `Object.prototype.toString` reports the same internal slots the probes below
 * read, and reports them without throwing. It stops being trustworthy only when
 * the value carries a `Symbol.toStringTag`, which anything can set, so a value
 * that has one is sent to the probes instead of being judged here.
 */
function couldHoldPrimitiveSlot(value: JsonTraversalReference): boolean {
  try {
    if (hasToStringTagWithoutHooks(value)) return true;
    const tag = reflectApply(objectToString, value, []);
    return tag === "[object Number]" || tag === "[object String]" ||
      tag === "[object Boolean]" || tag === "[object BigInt]";
  } catch {
    // Hostile metadata cannot answer this; let the probes decide.
    return true;
  }
}

/** The kind of primitive slot a boxed value carries. */
type BoxedPrimitiveSlot = "number" | "string" | "boolean" | "bigint";

/**
 * Which primitive slot a value carries, read without consulting metadata.
 *
 * Each probe throws on a miss, so reaching all four costs four thrown
 * exceptions, and a context is mostly made of objects that miss every one.
 * `couldHoldPrimitiveSlot` rejects those without throwing, which is what keeps
 * this off the cost of every object a run persists.
 */
function boxedPrimitiveSlot(value: JsonTraversalReference): BoxedPrimitiveSlot | null {
  if (!couldHoldPrimitiveSlot(value)) return null;
  try {
    reflectApply(NumberValueOf, value, []);
    return "number";
  } catch {
    // Try the next boxed primitive brand.
  }
  try {
    reflectApply(StringValueOf, value, []);
    return "string";
  } catch {
    // Try the next boxed primitive brand.
  }
  try {
    reflectApply(BooleanValueOf, value, []);
    return "boolean";
  } catch {
    // Try the next boxed primitive brand.
  }
  try {
    reflectApply(BigIntValueOf, value, []);
    return "bigint";
  } catch {
    return null;
  }
}

/**
 * Convert a boxed primitive the way JSON converts it.
 *
 * JSON puts a Number box through `ToNumber` and a String box through
 * `ToString`, and both of those ask the object, so a replaced `valueOf` or a
 * replaced prototype decides what JSON writes. Reading the slot instead would
 * persist a value JSON never wrote, which is the one outcome this module has to
 * avoid. A Boolean box is the case JSON does read straight from the slot.
 *
 * `+` and a template literal are used rather than `Number()` and `String()`,
 * which are close but not the same operations: `Number()` accepts a BigInt that
 * `ToNumber` refuses, so a `valueOf` returning one would be quietly coerced to a
 * number here and rejected by JSON. The parameter is `unknown` so each branch
 * needs one assertion rather than a chain; `slot` is what makes it sound.
 */
function unboxAsJsonWould(
  value: unknown,
  slot: BoxedPrimitiveSlot,
): string | number | boolean | bigint {
  if (slot === "number") return +(value as number);
  if (slot === "string") return `${value as string}`;
  if (slot === "boolean") return reflectApply(BooleanValueOf, value as boolean, []);
  // JSON refuses a BigInt box outright, and the walk reports it by its path.
  return reflectApply(BigIntValueOf, value as bigint, []);
}

/** Build the exact value JSON will encode, collecting what it cannot carry. */
function normalizeAndFindUnrepresentableValues(
  root: unknown,
  label: string,
  options: WorkflowJsonSerializationOptions = {},
): {
  normalized: unknown;
  unrepresentable: UnrepresentableValues;
} {
  const found: UnrepresentableValues = { fatal: [], lossy: [], fatalCount: 0, lossyCount: 0 };
  const active = new SetConstructor<JsonTraversalReference>();
  const completed = new SetConstructor<JsonTraversalReference>();

  const recordFatal = (path: string, kind: string) => {
    found.fatalCount++;
    if (found.fatal.length < MAX_REPORTED_PATHS) {
      defineArrayElement(found.fatal, found.fatal.length, { path, kind });
    }
  };

  // `index` is appended here rather than by the caller, so an array with more
  // holes than a message can show never builds the paths it would drop.
  const recordLossy = (path: string, kind: string, index?: number) => {
    found.lossyCount++;
    if (found.lossy.length >= MAX_REPORTED_PATHS) return;
    defineArrayElement(found.lossy, found.lossy.length, {
      path: index === undefined ? path : `${path}[${index}]`,
      kind,
    });
  };

  const recordEnumerableSymbolKeys = (value: JsonTraversalReference, path: string) => {
    if (!canIdentifyProxyWithoutHooks || isProxyWithoutHooks(value)) return;
    let symbolKeys: symbol[];
    try {
      symbolKeys = objectGetOwnPropertySymbols(value);
    } catch {
      return;
    }
    for (const symbolKey of symbolKeys) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = objectGetOwnPropertyDescriptor(value, symbolKey);
      } catch {
        continue;
      }
      if (descriptor?.enumerable === true) {
        recordLossy(path, "symbol-keyed property");
      }
    }
  };

  const recordArrayPrototype = (value: JsonTraversalReference, path: string) => {
    if (canIdentifyProxyWithoutHooks && isProxyWithoutHooks(value)) {
      recordLossy(path, "array proxy");
      return;
    }
    try {
      if (objectGetPrototypeOf(value) !== arrayPrototype) {
        recordLossy(path, "array prototype");
      }
    } catch {
      recordLossy(path, "uninspectable array prototype");
    }
  };

  const recordPropertyDescriptor = (
    descriptor: PropertyDescriptor | undefined,
    path: string,
  ) => {
    if (descriptor === undefined) return;
    if (!objectHasOwn(descriptor, "value")) {
      recordLossy(path, "accessor property");
      return;
    }
    if (
      descriptor.enumerable !== true ||
      descriptor.writable !== true ||
      descriptor.configurable !== true
    ) {
      recordLossy(path, "property attributes");
    }
  };

  const recordObjectExtensibility = (value: JsonTraversalReference, path: string) => {
    try {
      if (!objectIsExtensible(value)) recordLossy(path, "object extensibility");
    } catch {
      recordLossy(path, "uninspectable object extensibility");
    }
  };

  const recordArrayPropertiesFromOwnKeys = (
    value: JsonTraversalReference,
    path: string,
    length: number,
  ) => {
    let ownKeys: Array<string | symbol>;
    try {
      ownKeys = reflectOwnKeys(value);
    } catch {
      return;
    }
    let serializedIndexCount = 0;
    for (const ownKey of ownKeys) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = objectGetOwnPropertyDescriptor(value, ownKey);
      } catch {
        continue;
      }
      if (ownKey === "length") {
        if (descriptor !== undefined && descriptor.writable !== true) {
          recordLossy(path, "array length property");
        }
        continue;
      }
      if (typeof ownKey === "symbol") {
        if (descriptor !== undefined) recordLossy(path, "symbol-keyed property");
        continue;
      }
      const isSerializedIndex = isSerializedArrayIndexKey(ownKey, length);
      if (isSerializedIndex) {
        if (descriptor === undefined) continue;
        serializedIndexCount++;
        recordPropertyDescriptor(descriptor, `${path}[${ownKey}]`);
        continue;
      }
      if (descriptor === undefined) continue;
      recordLossy(
        `${path}.${redactPathSegment(ownKey)}`,
        descriptor.enumerable === true ? "array property" : "non-enumerable property",
      );
    }
    if (serializedIndexCount < length) recordLossy(path, "array hole");
  };

  const recordStrictArrayDiagnostics = (
    value: JsonTraversalReference,
    path: string,
    length: number,
  ) => {
    recordArrayPropertiesFromOwnKeys(value, path, length);
    recordArrayPrototype(value, path);
  };

  const normalize = (
    value: unknown,
    path: string,
    key: string,
    applyToJson: boolean,
    depth: number,
  ): NormalizedJsonValue | typeof OMIT_JSON_VALUE => {
    if (value === null) return null;

    const type = typeof value;
    if (
      type === "object" &&
      jsonIsRawJSON !== undefined &&
      reflectApply(jsonIsRawJSON, jsonRawSupport, [value])
    ) {
      recordLossy(path, "raw JSON value");
      return value as RawJsonValue;
    }
    if (
      applyToJson &&
      (type === "object" || type === "function" || type === "bigint")
    ) {
      const receiver = type === "bigint"
        ? ObjectConstructor(value)
        : value as JsonTraversalReference;
      const toJson = reflectGet(receiver, "toJSON");
      if (typeof toJson === "function") {
        const replacement = reflectApply(toJson, value, [key]);
        recordLossy(path, describeToJsonValue(value));
        return normalize(replacement, path, key, false, depth);
      }
    }

    if (type === "string" || type === "boolean") return value as string | boolean;
    if (type === "number") {
      if (!numberIsFinite(value)) {
        recordLossy(path, describe(value));
        return null;
      }
      if (objectIs(value, -0)) {
        recordLossy(path, "number (-0)");
        return 0;
      }
      return value as number;
    }
    if (type === "bigint") {
      recordFatal(path, "BigInt");
      return null;
    }
    if (type === "undefined" || type === "function" || type === "symbol") {
      recordLossy(path, describe(value));
      return OMIT_JSON_VALUE;
    }

    const nested = value as JsonTraversalReference;
    if (reflectApply(setHas, active, [nested])) {
      recordFatal(path, "circular reference");
      return null;
    }
    if (
      options.strictContext === true &&
      reflectApply(setHas, completed, [nested])
    ) {
      recordLossy(path, "shared reference");
    }

    const isArray = arrayIsArray(nested);
    if (!isArray) {
      const slot = boxedPrimitiveSlot(nested);
      if (slot !== null) {
        recordLossy(path, "boxed primitive");
        return normalize(unboxAsJsonWould(nested, slot), path, key, false, depth);
      }
    }

    // Native encoding must run at the cutoff, not after later siblings have
    // already been read. The active-reference and `toJSON` checks above still
    // run first, matching JSON's cycle and replacement semantics. A
    // one-property holder gives a deeper hook the same key it would receive in
    // the containing object. Raw primitive wrappers preserve exact encoded
    // tokens when the host supports them; older hosts parse them.
    if (depth >= MAX_TRAVERSAL_DEPTH) {
      if (options.strictContext === true) {
        recordLossy(path, "uninspected value");
        return nested as NormalizedJsonValue;
      }
      try {
        return normalizeJsonTail(nested, key, active);
      } catch (error) {
        if (error === ACTIVE_JSON_TAIL_REFERENCE) {
          recordFatal(path, "circular reference");
          return null;
        }
        if (error === BIGINT_JSON_TAIL_VALUE) {
          recordFatal(path, "BigInt");
          return null;
        }
        throw error;
      }
    }

    reflectApply(setAdd, active, [nested]);
    try {
      if (isArray) {
        const result: NormalizedJsonValue[] = [];
        const length = toJsonLength(reflectGet(nested, "length"));
        if (options.strictContext === true) {
          recordStrictArrayDiagnostics(nested, path, length);
        }
        const canInspectIndex = canIdentifyProxyWithoutHooks &&
          !isProxyWithoutHooks(nested);
        for (let index = 0; index < length; index++) {
          const indexKey = StringConstructor(index);
          let isHole = false;
          const child = reflectGet(nested, indexKey);
          if (options.strictContext !== true && canInspectIndex) {
            try {
              isHole = !objectHasOwn(nested, indexKey);
            } catch {
              // Hole diagnostics are best-effort; the captured value still wins.
            }
          }
          if (isHole) recordLossy(path, "array hole", index);
          if (isHole && child === undefined) {
            defineArrayElement(result, result.length, null);
            continue;
          }
          const normalized = normalize(
            child,
            `${path}[${index}]`,
            indexKey,
            true,
            depth + 1,
          );
          defineArrayElement(
            result,
            result.length,
            normalized === OMIT_JSON_VALUE ? null : normalized,
          );
          if (found.fatalCount > 0) break;
        }
        if (options.strictContext === true && found.fatalCount === 0) {
          recordObjectExtensibility(nested, path);
        }
        if (options.strictContext !== true) recordEnumerableSymbolKeys(nested, path);
        return result;
      }

      const result: NormalizedJsonObject = objectCreate(null);
      const childKeys = options.strictContext === true
        ? reflectOwnKeys(nested)
        : objectKeys(nested);
      for (let childIndex = 0; childIndex < childKeys.length; childIndex++) {
        if (found.fatalCount > 0) break;
        const ownKey = childKeys[childIndex]!;
        let childKey: string;
        if (options.strictContext === true) {
          const descriptor = objectGetOwnPropertyDescriptor(nested, ownKey);
          if (typeof ownKey === "symbol") {
            if (descriptor !== undefined) recordLossy(path, "symbol-keyed property");
            continue;
          }
          childKey = ownKey;
          if (descriptor === undefined) continue;
          if (descriptor.enumerable !== true) {
            recordLossy(
              `${path}.${redactPathSegment(childKey, depth === 0)}`,
              "non-enumerable property",
            );
            continue;
          }
          recordPropertyDescriptor(
            descriptor,
            `${path}.${redactPathSegment(childKey, depth === 0)}`,
          );
        } else {
          childKey = ownKey as string;
        }
        const childPath = `${path}.${redactPathSegment(childKey, depth === 0)}`;
        const normalized = normalize(
          reflectGet(nested, childKey),
          childPath,
          childKey,
          true,
          depth + 1,
        );
        if (normalized !== OMIT_JSON_VALUE) result[childKey] = normalized;
      }
      if (found.fatalCount === 0 && options.strictContext !== true) {
        recordEnumerableSymbolKeys(nested, path);
      }
      if (found.fatalCount === 0 && options.strictContext === true) {
        recordObjectExtensibility(nested, path);
      }
      // Prototype diagnostics are best-effort and run after the snapshot is
      // complete, so hostile metadata traps cannot change persistence output.
      if (
        found.fatalCount === 0 &&
        (
          (options.strictContext === true && isKnownNonPlainBuiltin(nested)) ||
          !isPlainObject(nested, options.strictContext === true)
        )
      ) {
        recordLossy(path, describe(nested));
      }
      return result;
    } finally {
      reflectApply(setDelete, active, [nested]);
      if (options.strictContext === true) reflectApply(setAdd, completed, [nested]);
    }
  };

  const normalized = normalize(root, label, "", true, 0);

  return {
    normalized: normalized === OMIT_JSON_VALUE ? undefined : normalized,
    unrepresentable: found,
  };
}

function formatPaths(samples: readonly UnrepresentableValue[], total: number): string {
  let shown = "";
  for (let index = 0; index < samples.length; index++) {
    if (index > 0) shown += ", ";
    shown += `${samples[index]!.path} (${samples[index]!.kind})`;
  }
  const remaining = total - samples.length;
  if (remaining <= 0) return shown;
  return shown ? `${shown}, and ${remaining} more` : `and ${remaining} more`;
}

/**
 * Serialize one field of a workflow run for durable storage.
 *
 * `WorkflowContext` is JSON-representable by contract, but nothing enforced it:
 * a step writes whatever it returns, and the in-memory backend keeps the value
 * intact, so a run that never suspends never notices. Persisting the same run
 * puts it through `JSON.stringify`, which quietly rewrites some values and
 * refuses others.
 *
 * Checking here makes the mismatch legible at the moment it matters:
 *
 * - Values JSON cannot encode at all fail the run with the field and redacted
 *   path that produced them, instead of `Do not know how to serialize a BigInt`
 *   raised from inside the backend with nothing pointing back at the step.
 * - Values it encodes lossily are logged with the same detail, because the
 *   alternative is a step reading a `string` where its predecessor wrote a
 *   `Date`, decided by whether the run happened to pause.
 *
 * Durable backends serialize context before its duplicate run projections, so
 * this check decides the diagnostic rather than the anonymous error a later
 * field would raise on the same value.
 *
 * Scope, stated plainly because the ordering above is easy to read as more:
 * only `context` is checked. A run's `input`, `output`, `nodeStates`,
 * `currentNodes`, and `error` are encoded directly, so nothing here inspects
 * them. That is deliberate for now: `nodeStates` carries a `Date` on every
 * node, so checking it would report the framework's own timestamps on every
 * run. Anything the framework writes into `context` has to obey the same rule
 * it asks of a step, which is why the loop encodes its child node states
 * rather than being exempted from the check.
 */
/** @internal Prepare the exact JSON value and encoded string for durable storage. */
export function prepareWorkflowJson(
  value: unknown,
  label: string,
  runId?: string,
  options: WorkflowJsonSerializationOptions = {},
): { normalized: unknown; serialized: string } {
  const { normalized, unrepresentable } = normalizeAndFindUnrepresentableValues(
    value,
    label,
    options,
  );
  const { fatal, fatalCount, lossy, lossyCount } = unrepresentable;

  if (fatalCount > 0) {
    throw ORCHESTRATION_ERROR.create({
      detail: `Workflow run cannot be persisted: ${formatPaths(fatal, fatalCount)}. Workflow ` +
        `state must be JSON-representable, because a run that suspends is stored as JSON. ` +
        `Return a plain object from the step that produced this value.`,
    });
  }

  if (options.strictContext === true && lossyCount > 0) {
    throw ORCHESTRATION_ERROR.create({
      detail:
        `Workflow run cannot be persisted with strictContext enabled: ${
          formatPaths(lossy, lossyCount)
        }. ` +
        `Workflow state must survive JSON persistence unchanged. Return only JSON values ` +
        `from the step that produced this value.`,
    });
  }

  const serialized = jsonStringify(normalized);
  if (serialized === undefined) {
    const paths = lossyCount > 0
      ? formatPaths(lossy, lossyCount)
      : `${label} (value omitted by JSON)`;
    throw ORCHESTRATION_ERROR.create({
      detail: `Workflow run cannot be persisted: ${paths}. Workflow state must produce a JSON ` +
        `document, because a run that suspends is stored as JSON. Return a plain object from ` +
        `the step that produced this value.`,
    });
  }

  if (lossyCount > 0) {
    const paths = formatPaths(lossy, lossyCount);
    logger.warn(
      "Workflow state holds values that do not survive persistence unchanged",
      {
        ...(runId ? { runId } : {}),
        paths,
      },
    );
  }

  // Encoded only once the fatal check has passed, so a value JSON refuses is
  // named by this module rather than by the anonymous error JSON raises.
  return { normalized, serialized };
}

export function serializeWorkflowJson(
  value: unknown,
  label: string,
  runId?: string,
  options?: WorkflowJsonSerializationOptions,
): string {
  return prepareWorkflowJson(value, label, runId, options).serialized;
}

/** Serialize a workflow context for durable storage. */
export function serializeWorkflowContext(
  context: WorkflowContext,
  runId?: string,
  options?: WorkflowJsonSerializationOptions,
): string {
  return serializeWorkflowJson(context, "context", runId, options);
}
