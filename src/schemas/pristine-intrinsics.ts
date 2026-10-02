/**
 * Pristine built-ins for schema validation.
 *
 * Task modules run in the runtime's shared realm, so a module can replace a
 * built-in such as `Array.prototype.map` while it is discovered. The
 * registered validator adapter and its library call those built-ins inside
 * `safeParse`, and would then throw instead of reporting validation errors.
 *
 * This module snapshots the built-ins at module load, before any project
 * module runs. `withPristineIntrinsics` puts back every snapshotted property
 * that has been replaced or deleted, runs a synchronous callback, then
 * re-applies the project's replacements, so the task still sees them when it
 * runs. JavaScript runs one callback at a time, so no other code observes the
 * swap. Work a callback defers to a promise runs after the swap is undone.
 *
 * See docs/adr/schema-validation-intrinsics.md.
 *
 * @module schemas/pristine-intrinsics
 */

type PropertyTarget = object;

interface IntrinsicProperty {
  target: PropertyTarget;
  key: PropertyKey;
  descriptor: PropertyDescriptor;
}

interface ReplacedProperty {
  target: PropertyTarget;
  key: PropertyKey;
  descriptor: PropertyDescriptor | undefined;
}

/** Runs a synchronous callback with the snapshotted built-ins in place. */
export type IntrinsicsGuard = <T>(callback: () => T) => T;

// Captured at module load: the guard itself must not depend on built-ins project code can replace.
const reflectApply = Reflect.apply;
const reflectDefineProperty = Reflect.defineProperty;
const reflectDeleteProperty = Reflect.deleteProperty;
const reflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const reflectGetPrototypeOf = Reflect.getPrototypeOf;
const reflectOwnKeys = Reflect.ownKeys;
const objectHasOwn = Object.hasOwn;
const DESCRIPTOR_FIELDS = [
  "value",
  "writable",
  "get",
  "set",
  "enumerable",
  "configurable",
] as const;

/**
 * Read an own property descriptor into a null-prototype object, so a field project code added to
 * `Object.prototype` (such as `get`) cannot leak into the descriptor when it is applied again.
 */
function ownDescriptor(target: PropertyTarget, key: PropertyKey): PropertyDescriptor | undefined {
  const descriptor = reflectGetOwnPropertyDescriptor(target, key);
  if (descriptor === undefined) return undefined;
  const copy: PropertyDescriptor = { __proto__: null } as PropertyDescriptor;
  for (let index = 0; index < DESCRIPTOR_FIELDS.length; index++) {
    const field = DESCRIPTOR_FIELDS[index]!;
    if (objectHasOwn(descriptor, field)) {
      reflectDefineProperty(copy, field, {
        __proto__: null,
        value: descriptor[field],
        enumerable: true,
      } as PropertyDescriptor);
    }
  }
  return copy;
}

function sameDescriptor(
  current: PropertyDescriptor | undefined,
  snapshot: PropertyDescriptor,
): boolean {
  return current !== undefined &&
    current.value === snapshot.value &&
    current.get === snapshot.get &&
    current.set === snapshot.set &&
    current.writable === snapshot.writable &&
    current.enumerable === snapshot.enumerable &&
    current.configurable === snapshot.configurable;
}

function snapshotProperties(
  targets: readonly PropertyTarget[],
  globalTarget: PropertyTarget,
  globalKeys: readonly PropertyKey[],
): IntrinsicProperty[] {
  const properties: IntrinsicProperty[] = [];
  const add = (target: PropertyTarget, key: PropertyKey): void => {
    const descriptor = ownDescriptor(target, key);
    if (descriptor) properties[properties.length] = { target, key, descriptor };
  };
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index]!;
    const keys = reflectOwnKeys(target);
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) add(target, keys[keyIndex]!);
  }
  for (let index = 0; index < globalKeys.length; index++) add(globalTarget, globalKeys[index]!);
  return properties;
}

function restoreProperty(property: ReplacedProperty): void {
  if (property.descriptor === undefined) {
    reflectDeleteProperty(property.target, property.key);
  } else {
    reflectDefineProperty(property.target, property.key, property.descriptor);
  }
}

/**
 * Snapshot every own property of `targets`, plus `globalKeys` on `globalTarget`, and return a
 * guard that runs callbacks against that snapshot.
 */
export function createIntrinsicsGuard(
  targets: readonly PropertyTarget[],
  globalTarget: PropertyTarget = globalThis,
  globalKeys: readonly PropertyKey[] = [],
): IntrinsicsGuard {
  const properties = snapshotProperties(targets, globalTarget, globalKeys);

  return <T>(callback: () => T): T => {
    const replaced: ReplacedProperty[] = [];
    try {
      for (let index = 0; index < properties.length; index++) {
        const { target, key, descriptor } = properties[index]!;
        const current = ownDescriptor(target, key);
        if (sameDescriptor(current, descriptor)) continue;
        // A property project code made non-configurable, or a frozen target, keeps its value.
        if (reflectDefineProperty(target, key, descriptor)) {
          replaced[replaced.length] = { target, key, descriptor: current };
        }
      }
      return reflectApply(callback, undefined, []);
    } finally {
      for (let index = replaced.length - 1; index >= 0; index--) restoreProperty(replaced[index]!);
    }
  };
}

/** The prototype of the iterators an iterable creates, such as `%ArrayIteratorPrototype%`. */
function iteratorPrototypeOf(iterable: Iterable<unknown>): PropertyTarget {
  return reflectGetPrototypeOf(iterable[Symbol.iterator]()) ?? Object.prototype;
}

const arrayIteratorPrototype = iteratorPrototypeOf([]);
const iteratorPrototype = reflectGetPrototypeOf(arrayIteratorPrototype) ?? Object.prototype;

/** Built-in objects whose own properties validator adapters and their libraries call. */
const INTRINSIC_TARGETS: readonly PropertyTarget[] = [
  Object,
  Object.prototype,
  Function.prototype,
  Array,
  Array.prototype,
  arrayIteratorPrototype,
  iteratorPrototype,
  String,
  String.prototype,
  iteratorPrototypeOf(""),
  Number,
  Number.prototype,
  Boolean.prototype,
  Symbol,
  Symbol.prototype,
  BigInt.prototype,
  Map.prototype,
  iteratorPrototypeOf(new Map()),
  Set.prototype,
  iteratorPrototypeOf(new Set()),
  WeakMap.prototype,
  WeakSet.prototype,
  RegExp,
  RegExp.prototype,
  Date,
  Date.prototype,
  Promise,
  Promise.prototype,
  Error,
  Error.prototype,
  JSON,
  Math,
  Reflect,
];

/** Global bindings validator adapters and their libraries look up by name. */
const INTRINSIC_GLOBALS: readonly PropertyKey[] = [
  "Object",
  "Function",
  "Array",
  "String",
  "Number",
  "Boolean",
  "Symbol",
  "BigInt",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "RegExp",
  "Date",
  "Promise",
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "JSON",
  "Math",
  "Reflect",
  "Intl",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "encodeURIComponent",
  "decodeURIComponent",
];

/**
 * Run `callback` with the built-ins as they were before any project module loaded. Use it around
 * synchronous validator adapter calls.
 */
export const withPristineIntrinsics: IntrinsicsGuard = createIntrinsicsGuard(
  INTRINSIC_TARGETS,
  globalThis,
  INTRINSIC_GLOBALS,
);
