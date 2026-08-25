/**
 * Extension boundary for decoding Skill document YAML frontmatter.
 *
 * Core owns the Skill document envelope, resource limits, mapping validation,
 * and metadata policy. Implementations own only YAML decoding.
 *
 * @module extensions/parser/skill-document-parser
 */

import {
  isNativePromiseWithoutHooks,
  isProxyWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";

const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const NativePromise = Promise;
const NativeTypeError = TypeError;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectHasOwnProperty = Object.prototype.hasOwnProperty;
const objectPrototype = Object.prototype;
const promiseThen = Promise.prototype.then;
const reflectDeleteProperty = Reflect.deleteProperty;
const reflectOwnKeys = Reflect.ownKeys;
const symbolSpecies = Symbol.species;

function ignorePromiseSettlement(): undefined {
  return undefined;
}

function call<T>(fn: (...args: never[]) => T, receiver: unknown, args: unknown[]): T {
  return apply(fn, receiver, args) as T;
}

function hasOwn(value: PropertyDescriptor, key: PropertyKey): boolean {
  return call(objectHasOwnProperty, value, [key]);
}

function createDataDescriptor(
  value: unknown,
  configurable: boolean,
  enumerable: boolean,
  writable: boolean,
): PropertyDescriptor {
  const descriptor = call<PropertyDescriptor>(objectCreate, Object, [null]);
  descriptor.configurable = configurable;
  descriptor.enumerable = enumerable;
  descriptor.value = value;
  descriptor.writable = writable;
  return descriptor;
}

function clonePropertyDescriptor(descriptor: PropertyDescriptor): PropertyDescriptor {
  const clone = call<PropertyDescriptor>(objectCreate, Object, [null]);
  for (
    const key of [
      "configurable",
      "enumerable",
      "get",
      "set",
      "value",
      "writable",
    ] as const
  ) {
    if (hasOwn(descriptor, key)) clone[key] = descriptor[key] as never;
  }
  return clone;
}

const safePromiseConstructor = (() => {
  const constructor = call<object>(objectCreate, Object, [null]);
  call(objectDefineProperty, Object, [
    constructor,
    symbolSpecies,
    createDataDescriptor(NativePromise, false, false, false),
  ]);
  return call<object>(objectFreeze, Object, [constructor]);
})();

/**
 * Observe ordinary accidental Promise results without consulting an
 * instance-owned constructor or the mutable Promise species hook.
 *
 * A non-configurable hostile constructor cannot be bypassed through the
 * JavaScript Promise API. In that case the contract still rejects
 * synchronously without invoking the hook; extension code is responsible for
 * not creating rejected Promises in the first place.
 */
function observePromiseSettlementWithoutHooks(promise: Promise<unknown>): void {
  let original: PropertyDescriptor | undefined;
  try {
    original = call(objectGetOwnPropertyDescriptor, Object, [
      promise,
      "constructor",
    ]);
  } catch {
    return;
  }

  let replacement: PropertyDescriptor;
  if (original === undefined) {
    replacement = createDataDescriptor(safePromiseConstructor, true, false, true);
  } else if (original.configurable === true) {
    replacement = createDataDescriptor(
      safePromiseConstructor,
      true,
      original.enumerable === true,
      true,
    );
  } else if (hasOwn(original, "value") && original.writable === true) {
    replacement = createDataDescriptor(
      safePromiseConstructor,
      false,
      original.enumerable === true,
      true,
    );
  } else {
    return;
  }

  let installed = false;
  try {
    call(objectDefineProperty, Object, [promise, "constructor", replacement]);
    installed = true;
    call(promiseThen, promise, [
      ignorePromiseSettlement,
      ignorePromiseSettlement,
    ]);
  } catch {
    // The synchronous provider contract is rejected below. Never trade that
    // deterministic failure for extension-owned constructor/species hooks.
  } finally {
    if (installed) {
      try {
        if (original === undefined) {
          call(reflectDeleteProperty, Reflect, [promise, "constructor"]);
        } else {
          call(objectDefineProperty, Object, [
            promise,
            "constructor",
            clonePropertyDescriptor(original),
          ]);
        }
      } catch {
        // A genuine Promise is not a Proxy; restoration can fail only after a
        // contract-violating extension result and must not replace the public
        // synchronous-contract error.
      }
    }
  }
}

/** Stable runtime identifier for the Skill document parser contract. */
export const SkillDocumentParserProviderName = "SkillDocumentParserProvider" as const;

/** Dependency-free contract implemented by Skill YAML parser extensions. */
export interface SkillDocumentParserProvider {
  /**
   * Decode the YAML source extracted from a Skill document's frontmatter.
   *
   * Implementations must be synchronous and must not create or return Promise
   * values. The returned value is untrusted; core validates and snapshots the
   * required mapping before using it.
   */
  readonly parseFrontmatter: (source: string) => unknown;
}

function providerInspectionError(cause?: unknown): TypeError {
  return new NativeTypeError(
    "Skill document parser provider must be a plain object with one enumerable parseFrontmatter data-function property",
    cause === undefined ? undefined : { cause },
  );
}

/**
 * Capture one immutable provider generation without retaining its mutable
 * registration object or invoking extension-owned accessors or Proxy traps.
 */
export function snapshotSkillDocumentParserProvider(
  value: unknown,
): Readonly<SkillDocumentParserProvider> {
  if (typeof value !== "object" || value === null) {
    throw providerInspectionError();
  }

  let isProxy: boolean;
  try {
    isProxy = isProxyWithoutHooks(value);
  } catch (cause) {
    throw providerInspectionError(cause);
  }
  if (isProxy) {
    throw providerInspectionError();
  }

  let isArray: boolean;
  let prototype: object | null;
  let keys: PropertyKey[];
  let descriptor: PropertyDescriptor | undefined;
  try {
    isArray = call(arrayIsArray, Array, [value]);
    prototype = call(objectGetPrototypeOf, Object, [value]);
    keys = call(reflectOwnKeys, Reflect, [value]);
    descriptor = call(objectGetOwnPropertyDescriptor, Object, [
      value,
      "parseFrontmatter",
    ]);
  } catch (cause) {
    throw providerInspectionError(cause);
  }

  if (
    isArray ||
    (prototype !== objectPrototype && prototype !== null) ||
    keys.length !== 1 ||
    keys[0] !== "parseFrontmatter" ||
    descriptor === undefined ||
    descriptor.enumerable !== true ||
    !hasOwn(descriptor, "value") ||
    typeof descriptor.value !== "function"
  ) {
    throw providerInspectionError();
  }

  const parseFrontmatter = descriptor.value as (source: string) => unknown;
  let parserIsProxy: boolean;
  try {
    parserIsProxy = isProxyWithoutHooks(parseFrontmatter);
  } catch (cause) {
    throw providerInspectionError(cause);
  }
  if (parserIsProxy) {
    throw providerInspectionError();
  }

  const facade: SkillDocumentParserProvider = {
    parseFrontmatter(source: string): unknown {
      if (typeof source !== "string") {
        throw new NativeTypeError("Skill frontmatter source must be a string");
      }
      const parsed = call(parseFrontmatter, undefined, [source]);
      if (isNativePromiseWithoutHooks(parsed)) {
        observePromiseSettlementWithoutHooks(parsed);
        throw new NativeTypeError(
          "Skill document parser provider must be synchronous",
        );
      }
      return parsed;
    },
  };
  return apply(objectFreeze, Object, [facade]) as Readonly<
    SkillDocumentParserProvider
  >;
}

/** Create immutable provider registration metadata from a standalone parser. */
export function createSkillDocumentParserProvider(
  parseFrontmatter: (source: string) => unknown,
): Readonly<SkillDocumentParserProvider> {
  return snapshotSkillDocumentParserProvider({ parseFrontmatter });
}
