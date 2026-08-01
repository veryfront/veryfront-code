import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";
import type { CacheBackend } from "./types.ts";

const apply = Reflect.apply;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const numberIsSafeInteger = Number.isSafeInteger;
const MAX_CACHE_CAPABILITY_PROTOTYPE_DEPTH = 64;
const universalObjectPrototype = Object.prototype;
const universalFunctionPrototype = Function.prototype;

/** Deterministic overflow from an exact bounded cache read. */
export class CacheValueTooLargeError extends RangeError {
  readonly maximumBytes: number;

  constructor(maximumBytes: number) {
    super(`Cache value exceeds ${maximumBytes} UTF-8 bytes`);
    this.name = "CacheValueTooLargeError";
    this.maximumBytes = maximumBytes;
  }
}

/** Validate one caller-supplied cache payload byte ceiling. */
export function assertCacheReadMaximumBytes(maximumBytes: number): number {
  if (!numberIsSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new RangeError("Cache value byte limit must be a non-negative safe integer");
  }
  return maximumBytes;
}

/** Verify a string payload without allocating an encoded copy. */
export function assertCacheValueWithinLimit(
  value: string,
  maximumBytes: number,
): number {
  const admittedMaximum = assertCacheReadMaximumBytes(maximumBytes);
  if (typeof value !== "string") {
    throw new TypeError("Bounded cache value must be a string");
  }
  if (value.length > admittedMaximum) {
    throw new CacheValueTooLargeError(admittedMaximum);
  }
  const byteLength = utf8ByteLength(value, admittedMaximum);
  if (byteLength > admittedMaximum) {
    throw new CacheValueTooLargeError(admittedMaximum);
  }
  return byteLength;
}

export interface CapturedBoundedCacheRead {
  readonly getWithinLimit: NonNullable<CacheBackend["getWithinLimit"]>;
}

/** Capture an optional bounded-read capability without accessors or Proxy traps. */
export function captureBoundedCacheRead(
  backend: unknown,
): CapturedBoundedCacheRead | null {
  if (
    (typeof backend !== "object" && typeof backend !== "function") ||
    backend === null ||
    isProxyWithoutHooks(backend)
  ) {
    return null;
  }

  let owner: object | null = backend;
  const seen = new Set<object>();
  try {
    for (let depth = 0; owner !== null && depth < MAX_CACHE_CAPABILITY_PROTOTYPE_DEPTH; depth++) {
      if (owner === universalObjectPrototype || owner === universalFunctionPrototype) {
        return null;
      }
      if (isProxyWithoutHooks(owner) || seen.has(owner)) return null;
      seen.add(owner);
      const parent = getPrototypeOf(owner);
      if (owner !== backend && parent === null) return null;
      const descriptor = getOwnPropertyDescriptor(owner, "getWithinLimit");
      if (descriptor !== undefined) {
        if (
          !("value" in descriptor) ||
          typeof descriptor.value !== "function" ||
          isProxyWithoutHooks(descriptor.value)
        ) {
          return null;
        }
        const method = descriptor.value as NonNullable<CacheBackend["getWithinLimit"]>;
        const captured = Object.create(null) as CapturedBoundedCacheRead;
        Object.defineProperty(captured, "getWithinLimit", {
          value: (key: string, maximumBytes: number) =>
            apply(method, backend, [key, maximumBytes]) as Promise<string | null>,
          enumerable: true,
        });
        return freeze(captured);
      }
      owner = parent;
    }
  } catch {
    return null;
  }
  return null;
}

/** Invoke and post-verify one exact bounded cache read. */
export async function readCacheValueWithinLimit(
  backend: CacheBackend,
  key: string,
  maximumBytes: number,
): Promise<string | null> {
  const admittedMaximum = assertCacheReadMaximumBytes(maximumBytes);
  const capability = captureBoundedCacheRead(backend);
  if (capability === null) {
    throw new TypeError("Cache backend does not expose an exact bounded-read capability");
  }
  const value = await capability.getWithinLimit(key, admittedMaximum);
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new TypeError("Bounded cache backend returned a non-string value");
  }
  assertCacheValueWithinLimit(value, admittedMaximum);
  return value;
}
