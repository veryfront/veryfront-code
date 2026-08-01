import {
  assertCacheReadMaximumBytes,
  assertCacheValueWithinLimit,
  CacheValueTooLargeError,
} from "#veryfront/cache/bounded-read.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";
import {
  MAX_CSS_OUTPUT_FILE_BYTES,
  MAX_CSS_SELECTOR_EVIDENCE_BYTES,
  MAX_CSS_SELECTOR_TOKENS,
} from "#veryfront/utils/constants/css.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";

const UNIFIED_CSS_CACHE_FRAMING_BYTES = JSON.stringify({
  css: "",
  candidates: [],
  stylesheet: "",
}).length;
const CSS_INPUTS_CACHE_FRAMING_BYTES = JSON.stringify({
  candidates: [],
  stylesheet: "",
}).length;
const PROJECT_CSS_CACHE_FRAMING_BYTES = JSON.stringify({
  css: "",
  hash: "".padEnd(64, "0"),
  candidatesHash: "".padEnd(64, "0"),
}).length;
const PREPARED_CSS_CACHE_FRAMING_BYTES = JSON.stringify({
  css: "",
  hash: "".padEnd(64, "0"),
}).length;
const CANDIDATE_ARRAY_SEPARATOR_BYTES = MAX_CSS_SELECTOR_TOKENS * 3;
// Regeneration stores the merged stylesheet, not one authored CSS file.
const MAX_CSS_REGENERATION_STYLESHEET_BYTES = MAX_CSS_OUTPUT_FILE_BYTES;
const RETAINED_STRING_COPY_CHUNK_CODE_UNITS = 8 * 1024;
const RETAINED_STRING_STORAGE_NODE_BYTES = 40;
const apply = Reflect.apply;
const arrayJoin = Array.prototype.join;
const defineProperty = Object.defineProperty;
const hasProperty = Reflect.has;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringFromCharCode = String.fromCharCode;
const CSS_CACHE_JSON_MAX_DEPTH = 4;

interface ByteWeightedLRUOptions {
  maxEntries: number;
  maxEntrySizeBytes: number;
  maxSizeBytes: number;
}

interface ByteWeightedLRUEntry<V> {
  value: V;
  sizeBytes: number;
}

function requireNonNegativeSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

/**
 * Small dependency-free LRU used by CSS caches whose values need explicit
 * retained-size admission rather than entry-count-only bounds.
 */
export class ByteWeightedLRUCache<K, V> {
  readonly maxEntries: number;
  readonly maxEntrySizeBytes: number;
  readonly maxSizeBytes: number;
  #entries = new Map<K, ByteWeightedLRUEntry<V>>();
  #sizeBytes = 0;

  constructor(options: ByteWeightedLRUOptions) {
    this.maxEntries = requireNonNegativeSafeInteger(options.maxEntries, "maxEntries");
    this.maxEntrySizeBytes = requireNonNegativeSafeInteger(
      options.maxEntrySizeBytes,
      "maxEntrySizeBytes",
    );
    this.maxSizeBytes = requireNonNegativeSafeInteger(options.maxSizeBytes, "maxSizeBytes");
    if (this.maxEntrySizeBytes > this.maxSizeBytes) {
      throw new RangeError("maxEntrySizeBytes cannot exceed maxSizeBytes");
    }
  }

  get size(): number {
    return this.#entries.size;
  }

  get sizeBytes(): number {
    return this.#sizeBytes;
  }

  get(key: K): V | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value;
  }

  peek(key: K): V | undefined {
    return this.#entries.get(key)?.value;
  }

  set(key: K, value: V, sizeBytes: number): boolean {
    const admittedSize = requireNonNegativeSafeInteger(sizeBytes, "Cache entry sizeBytes");
    this.delete(key);
    if (
      this.maxEntries === 0 ||
      admittedSize > this.maxEntrySizeBytes ||
      admittedSize > this.maxSizeBytes
    ) {
      return false;
    }

    while (
      this.#entries.size >= this.maxEntries ||
      this.#sizeBytes > this.maxSizeBytes - admittedSize
    ) {
      const oldest = this.#entries.keys().next();
      if (oldest.done) break;
      this.delete(oldest.value);
    }

    if (
      this.#entries.size >= this.maxEntries ||
      this.#sizeBytes > this.maxSizeBytes - admittedSize
    ) {
      return false;
    }
    this.#entries.set(key, { value, sizeBytes: admittedSize });
    this.#sizeBytes += admittedSize;
    return true;
  }

  delete(key: K): boolean {
    const entry = this.#entries.get(key);
    if (!entry) return false;
    this.#entries.delete(key);
    this.#sizeBytes -= entry.sizeBytes;
    return true;
  }

  clear(): void {
    this.#entries.clear();
    this.#sizeBytes = 0;
  }

  *keys(): IterableIterator<K> {
    yield* this.#entries.keys();
  }

  *entries(): IterableIterator<[K, V]> {
    for (const [key, entry] of this.#entries) yield [key, entry.value];
  }
}

function detachedStringStorageNodes(codeUnits: number): number {
  const leafNodes = Math.max(
    1,
    Math.ceil(codeUnits / RETAINED_STRING_COPY_CHUNK_CODE_UNITS),
  );
  // A multi-chunk join may retain every leaf, a binary rope node per join,
  // and an additional root/thin-string wrapper.
  return leafNodes === 1 ? 1 : leafNodes * 2 + 1;
}

/** Conservative detached-string graph estimate, including possible rope nodes. */
export function estimateRetainedStringBytes(value: string): number {
  if (typeof value !== "string") throw new TypeError("Retained cache string must be a string");
  const utf16Bytes = value.length * 2;
  if (!Number.isSafeInteger(utf16Bytes)) {
    throw new RangeError("Retained cache string size exceeds the safe integer range");
  }
  const storageNodeBytes = detachedStringStorageNodes(value.length) *
    RETAINED_STRING_STORAGE_NODE_BYTES;
  if (!Number.isSafeInteger(storageNodeBytes)) {
    throw new RangeError("Retained cache string graph exceeds the safe integer range");
  }
  return storageNodeBytes + Math.max(utf16Bytes, utf8ByteLength(value));
}

/**
 * Rebuild a string from its UTF-16 code units so a cached token or substring
 * cannot keep an unaccounted parent string or rope alive.
 */
export function detachRetainedString(value: string): string {
  if (typeof value !== "string") {
    throw new TypeError("Retained cache string must be a string");
  }
  if (value.length === 0) return "";

  const chunks = new Array<string>(
    Math.ceil(value.length / RETAINED_STRING_COPY_CHUNK_CODE_UNITS),
  );
  const charCodeArguments = [0];
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const start = chunkIndex * RETAINED_STRING_COPY_CHUNK_CODE_UNITS;
    const end = Math.min(start + RETAINED_STRING_COPY_CHUNK_CODE_UNITS, value.length);
    const codeUnits = new Uint16Array(end - start);
    for (let index = start; index < end; index++) {
      charCodeArguments[0] = index;
      codeUnits[index - start] = apply(stringCharCodeAt, value, charCodeArguments) as number;
    }
    defineProperty(chunks, chunkIndex, {
      configurable: true,
      enumerable: true,
      value: apply(stringFromCharCode, undefined, codeUnits) as string,
      writable: true,
    });
  }

  return chunks.length === 1 ? chunks[0]! : apply(arrayJoin, chunks, [""]) as string;
}

/**
 * Practical serialized cache capacity for one unified entry. Individual
 * fields remain governed by their semantic limits; JSON escaping that pushes
 * the final representation over this aggregate budget makes caching optional
 * instead of permitting unbounded storage or reads.
 */
export const MAX_CSS_SERIALIZED_CACHE_ENTRY_BYTES = MAX_CSS_OUTPUT_FILE_BYTES +
  MAX_CSS_SELECTOR_EVIDENCE_BYTES +
  MAX_CSS_REGENERATION_STYLESHEET_BYTES + CANDIDATE_ARRAY_SEPARATOR_BYTES +
  UNIFIED_CSS_CACHE_FRAMING_BYTES;

export const MAX_CSS_INPUTS_SERIALIZED_CACHE_ENTRY_BYTES = MAX_CSS_SELECTOR_EVIDENCE_BYTES +
  MAX_CSS_REGENERATION_STYLESHEET_BYTES +
  CANDIDATE_ARRAY_SEPARATOR_BYTES + CSS_INPUTS_CACHE_FRAMING_BYTES;

export const MAX_PROJECT_CSS_SERIALIZED_CACHE_ENTRY_BYTES = MAX_CSS_OUTPUT_FILE_BYTES +
  PROJECT_CSS_CACHE_FRAMING_BYTES;

export const MAX_PREPARED_CSS_SERIALIZED_CACHE_ENTRY_BYTES = MAX_CSS_OUTPUT_FILE_BYTES +
  PREPARED_CSS_CACHE_FRAMING_BYTES;

/** Verify a serialized cache value immediately before parsing or storage. */
export function assertCSSSerializedCacheValue(
  value: string,
  maximumBytes = MAX_CSS_SERIALIZED_CACHE_ENTRY_BYTES,
): string {
  assertCacheValueWithinLimit(value, maximumBytes);
  return value;
}

class CSSCacheJsonByteMeter {
  byteLength = 0;

  constructor(readonly maximumBytes: number) {}

  add(bytes: number): void {
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      bytes > this.maximumBytes - this.byteLength
    ) {
      throw new CacheValueTooLargeError(this.maximumBytes);
    }
    this.byteLength += bytes;
  }
}

function measureJsonString(value: string, meter: CSSCacheJsonByteMeter): void {
  meter.add(1);
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (
      codeUnit === 0x22 ||
      codeUnit === 0x5c ||
      codeUnit === 0x08 ||
      codeUnit === 0x09 ||
      codeUnit === 0x0a ||
      codeUnit === 0x0c ||
      codeUnit === 0x0d
    ) {
      meter.add(2);
      continue;
    }
    if (codeUnit < 0x20) {
      meter.add(6);
      continue;
    }
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        meter.add(4);
        index++;
      } else {
        // Well-formed JSON.stringify escapes lone UTF-16 surrogates.
        meter.add(6);
      }
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      meter.add(6);
      continue;
    }
    meter.add(codeUnit <= 0x7f ? 1 : codeUnit <= 0x7ff ? 2 : 3);
  }
  meter.add(1);
}

function isJsonOmittedValue(value: unknown): boolean {
  const type = typeof value;
  return type === "undefined" || type === "function" || type === "symbol";
}

function assertNoJsonSerializationHook(value: object): void {
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth <= CSS_CACHE_JSON_MAX_DEPTH; depth++) {
    if (isProxyWithoutHooks(owner)) {
      throw new TypeError("CSS cache values must not contain Proxy objects");
    }
    const descriptor = Object.getOwnPropertyDescriptor(owner, "toJSON");
    if (
      descriptor !== undefined &&
      (!("value" in descriptor) || typeof descriptor.value === "function")
    ) {
      throw new TypeError("CSS cache values must not expose a toJSON hook");
    }
    owner = Object.getPrototypeOf(owner);
  }
  if (owner !== null) {
    throw new TypeError("CSS cache value prototype chain is too deep");
  }
}

function measureCSSCacheJsonValue(
  value: unknown,
  meter: CSSCacheJsonByteMeter,
  active: Set<object>,
  depth: number,
): boolean {
  if (isJsonOmittedValue(value)) return false;
  if (value === null) {
    meter.add(4);
    return true;
  }

  switch (typeof value) {
    case "string":
      measureJsonString(value, meter);
      return true;
    case "boolean":
      meter.add(value ? 4 : 5);
      return true;
    case "number": {
      const encoded = Number.isFinite(value) ? Object.is(value, -0) ? "0" : String(value) : "null";
      meter.add(encoded.length);
      return true;
    }
    case "bigint":
      throw new TypeError("CSS cache value cannot contain a BigInt");
    case "object":
      break;
    default:
      return false;
  }

  if (depth >= CSS_CACHE_JSON_MAX_DEPTH) {
    throw new TypeError(
      `CSS cache value cannot exceed ${CSS_CACHE_JSON_MAX_DEPTH} JSON container levels`,
    );
  }
  const object = value as object;
  assertNoJsonSerializationHook(object);
  if (active.has(object)) {
    throw new TypeError("CSS cache value cannot contain a circular reference");
  }
  active.add(object);
  try {
    if (Array.isArray(object)) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(object, "length");
      const length = lengthDescriptor && "value" in lengthDescriptor
        ? lengthDescriptor.value
        : undefined;
      if (!Number.isSafeInteger(length) || length < 0) {
        throw new TypeError("CSS cache arrays must have a safe data-property length");
      }
      meter.add(1);
      for (let index = 0; index < length; index++) {
        if (index > 0) meter.add(1);
        const descriptor = Object.getOwnPropertyDescriptor(object, String(index));
        if (descriptor === undefined || !("value" in descriptor)) {
          if (descriptor !== undefined) {
            throw new TypeError("CSS cache arrays must not contain accessors");
          }
          if (hasProperty(object, String(index))) {
            throw new TypeError("CSS cache arrays must not inherit indexed properties");
          }
          meter.add(4);
          continue;
        }
        if (
          isJsonOmittedValue(descriptor.value) ||
          !measureCSSCacheJsonValue(descriptor.value, meter, active, depth + 1)
        ) {
          meter.add(4);
        }
      }
      meter.add(1);
      return true;
    }

    const prototype = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("CSS cache values must contain only plain data objects");
    }
    meter.add(1);
    let retainedProperties = 0;
    for (const key of Reflect.ownKeys(object)) {
      if (typeof key !== "string") continue;
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (descriptor === undefined || descriptor.enumerable !== true) continue;
      if (!("value" in descriptor)) {
        throw new TypeError("CSS cache objects must not contain accessors");
      }
      if (isJsonOmittedValue(descriptor.value)) continue;
      if (retainedProperties > 0) meter.add(1);
      measureJsonString(key, meter);
      meter.add(1);
      if (!measureCSSCacheJsonValue(descriptor.value, meter, active, depth + 1)) {
        throw new Error("CSS cache JSON preflight lost an admitted property");
      }
      retainedProperties++;
    }
    meter.add(1);
    return true;
  } finally {
    active.delete(object);
  }
}

function preflightCSSCacheJson(value: unknown, maximumBytes: number): void {
  const meter = new CSSCacheJsonByteMeter(
    assertCacheReadMaximumBytes(maximumBytes),
  );
  if (!measureCSSCacheJsonValue(value, meter, new Set<object>(), 0)) {
    throw new TypeError("CSS cache value is not JSON-serializable");
  }
}

/** Serialize and enforce the selected CSS cache envelope budget. */
export function serializeCSSCacheValue(
  value: unknown,
  maximumBytes = MAX_CSS_SERIALIZED_CACHE_ENTRY_BYTES,
): string {
  preflightCSSCacheJson(value, maximumBytes);
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("CSS cache value is not JSON-serializable");
  }
  try {
    return assertCSSSerializedCacheValue(serialized, maximumBytes);
  } catch (cause) {
    if (cause instanceof CacheValueTooLargeError) throw cause;
    throw new TypeError("CSS cache value could not be admitted", { cause });
  }
}
