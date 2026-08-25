import {
  isNativeErrorWithoutHooks,
  isProxyWithoutHooks,
  readNativeErrorNameWithoutHooks,
} from "./error-introspection.ts";
import { isDeno } from "./runtime.ts";

const MAX_CAUSE_DEPTH = 64;
const MAX_PROTOTYPE_DEPTH = 32;
const NO_DATA_VALUE = Symbol("no-data-value");
const NO_OWN_PROPERTY = Symbol("no-own-property");
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const reflectApply = Reflect.apply;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;

function hasOwn(value: PropertyDescriptor, key: PropertyKey): boolean {
  return reflectApply(hasOwnProperty, value, [key]) as boolean;
}

function readOwnDataValue(
  value: object,
  key: PropertyKey,
): unknown | typeof NO_DATA_VALUE | typeof NO_OWN_PROPERTY {
  if (isProxyWithoutHooks(value)) return NO_DATA_VALUE;
  try {
    const descriptor = getOwnPropertyDescriptor(value, key);
    if (!descriptor) return NO_OWN_PROPERTY;
    return hasOwn(descriptor, "value") ? descriptor.value : NO_DATA_VALUE;
  } catch {
    return NO_DATA_VALUE;
  }
}

function readDataValue(value: object, key: PropertyKey): unknown | typeof NO_DATA_VALUE {
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < MAX_PROTOTYPE_DEPTH; depth++) {
    const result = readOwnDataValue(owner, key);
    if (result === NO_DATA_VALUE) return NO_DATA_VALUE;
    if (result !== NO_OWN_PROPERTY) return result;
    if (isProxyWithoutHooks(owner)) return NO_DATA_VALUE;
    try {
      owner = getPrototypeOf(owner);
    } catch {
      return NO_DATA_VALUE;
    }
  }
  return NO_DATA_VALUE;
}

function readClassifiedDataValue(
  value: object,
  key: PropertyKey,
  ownOnly: boolean,
): unknown | typeof NO_DATA_VALUE {
  if (!ownOnly) return readDataValue(value, key);
  const result = readOwnDataValue(value, key);
  return result === NO_OWN_PROPERTY ? NO_DATA_VALUE : result;
}

function captureDenoNotFoundPrototype(): object | undefined {
  if (!isDeno) return undefined;
  const deno = readOwnDataValue(globalThis, "Deno");
  if (typeof deno !== "object" || deno === null) return undefined;
  const errors = readOwnDataValue(deno, "errors");
  if (typeof errors !== "object" || errors === null) return undefined;
  const NotFound = readOwnDataValue(errors, "NotFound");
  if (typeof NotFound !== "function" || isProxyWithoutHooks(NotFound)) return undefined;
  const prototype = readOwnDataValue(NotFound, "prototype");
  return typeof prototype === "object" && prototype !== null ? prototype : undefined;
}

const denoNotFoundPrototype = captureDenoNotFoundPrototype();

function inheritsFrom(value: object, expectedPrototype: object): boolean {
  let prototype: object | null = value;
  for (let depth = 0; prototype !== null && depth < MAX_PROTOTYPE_DEPTH; depth++) {
    if (isProxyWithoutHooks(prototype)) return false;
    try {
      prototype = getPrototypeOf(prototype);
    } catch {
      return false;
    }
    if (prototype === expectedPrototype) return true;
  }
  return false;
}

function normalizeSeenSet(seen: Set<unknown>): Set<unknown> {
  try {
    reflectApply(setHas, seen, [seen]);
    return seen;
  } catch {
    return new Set<unknown>();
  }
}

function markSeen(seen: Set<unknown>, value: object): boolean {
  if (reflectApply(setHas, seen, [value]) as boolean) return false;
  reflectApply(setAdd, seen, [value]);
  return true;
}

function isLegacyFileNotFoundError(
  error: Error,
  name: string,
  ownDataOnly: boolean,
): boolean {
  if (name !== "VeryfrontError[file]") return false;
  const context = readClassifiedDataValue(error, "context", ownDataOnly);
  if (
    typeof context !== "object" || context === null ||
    isProxyWithoutHooks(context)
  ) {
    return false;
  }
  const type = readClassifiedDataValue(context, "type", ownDataOnly);
  const message = readClassifiedDataValue(context, "message", ownDataOnly);
  return type === "file" &&
    typeof message === "string" &&
    /^(?:File|Path) not found:/.test(message);
}

/**
 * Return whether an error or its bounded cause chain represents a path that
 * cannot be resolved. ENOTDIR is included because a missing candidate beneath
 * a file is just as absent as an ENOENT candidate during filesystem lookup.
 * Project-owned accessors and Proxy traps are never evaluated.
 */
function classifyNotFoundError(
  error: unknown,
  seen: Set<unknown>,
  requireNativeCauseChain: boolean,
): boolean {
  const visited = normalizeSeenSet(seen);
  let current = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (
      typeof current !== "object" || current === null ||
      isProxyWithoutHooks(current) || !markSeen(visited, current)
    ) {
      return false;
    }

    if (requireNativeCauseChain && !isNativeErrorWithoutHooks(current)) {
      return false;
    }

    const code = readClassifiedDataValue(
      current,
      "code",
      requireNativeCauseChain,
    );
    if (code === "ENOENT" || code === "ENOTDIR") return true;
    if (!isNativeErrorWithoutHooks(current)) return false;

    if (denoNotFoundPrototype && inheritsFrom(current, denoNotFoundPrototype)) {
      return true;
    }

    const name = readNativeErrorNameWithoutHooks(current);
    const structuralName = requireNativeCauseChain
      ? readClassifiedDataValue(current, "name", true)
      : name;
    if (
      structuralName === "VeryfrontError" &&
      readClassifiedDataValue(current, "slug", requireNativeCauseChain) === "file-not-found"
    ) {
      return true;
    }
    if (
      typeof structuralName === "string" &&
      isLegacyFileNotFoundError(
        current,
        structuralName,
        requireNativeCauseChain,
      )
    ) {
      return true;
    }

    const cause = readClassifiedDataValue(
      current,
      "cause",
      requireNativeCauseChain,
    );
    if (cause === NO_DATA_VALUE) return false;
    current = cause;
  }

  return false;
}

/**
 * Strict absence classifier for fail-closed filesystem boundaries.
 *
 * Every value in the inspected cause chain must carry the runtime's native
 * Error brand. This keeps arbitrary error-shaped records such as
 * `{ code: "ENOENT" }` from being converted into ordinary absence while still
 * recognizing native Deno, Node, and Veryfront not-found errors without
 * invoking project-owned hooks.
 */
export function isCanonicalNotFoundError(error: unknown): boolean {
  return classifyNotFoundError(error, new Set(), true);
}

export function isNotFoundError(error: unknown, seen: Set<unknown> = new Set()): boolean {
  return classifyNotFoundError(error, seen, false);
}
