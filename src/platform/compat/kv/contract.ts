import { PLATFORM_ERROR } from "#veryfront/errors/error-registry/deploy.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors/error-registry/general.ts";
import { KV_PORTABLE_LIMITS, type KvJsonValue, type KvListOptions } from "./types.ts";

const VERSIONSTAMP_TICKS_PER_MILLISECOND = 1_000_000n;
const VERSIONSTAMP_MINIMUM_WIDTH = 20;
const VERSIONSTAMP_FORMAT_PREFIX = "v2:";
const textEncoder = new TextEncoder();

export interface NormalizedKvListOptions {
  prefix?: string[];
  start?: string[];
  end?: string[];
  limit?: number;
  maxScanEntries: number;
  reverse: boolean;
}

export interface SelectableKvEntry<T> {
  encodedKey: string;
  key: string[];
  value: T;
  versionstamp?: string;
}

/** Compare JSON-encoded keys by Unicode scalar value, matching UTF-8 binary ordering. */
export function compareEncodedKvKeys(left: string, right: string): number {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftCodePoint = left.codePointAt(leftIndex)!;
    const rightCodePoint = right.codePointAt(rightIndex)!;
    if (leftCodePoint !== rightCodePoint) return leftCodePoint < rightCodePoint ? -1 : 1;
    leftIndex += leftCodePoint > 0xffff ? 2 : 1;
    rightIndex += rightCodePoint > 0xffff ? 2 : 1;
  }
  return leftIndex < left.length ? 1 : rightIndex < right.length ? -1 : 0;
}

function invalidArgument(message: string): never {
  throw INVALID_ARGUMENT.create({ message });
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (!(trailing >= 0xdc00 && trailing <= 0xdfff)) return false;
      index++;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function snapshotStringKey(value: unknown, allowEmpty = false): string[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const length = value.length;
    if (length > KV_PORTABLE_LIMITS.maxKeyParts) return undefined;
    if (length === 0) return allowEmpty ? [] : undefined;
    const snapshot = new Array<string>(length);
    for (let index = 0; index < length; index++) {
      const part = value[index];
      if (
        typeof part !== "string" || part.length > KV_PORTABLE_LIMITS.maxKeyBytes ||
        !isWellFormedUnicode(part)
      ) return undefined;
      snapshot[index] = part;
    }
    return snapshot;
  } catch {
    return undefined;
  }
}

function portableKeySize(key: readonly string[]): number {
  let size = 0;
  for (const part of key) {
    const bytes = textEncoder.encode(part);
    size += 2;
    for (const byte of bytes) size += byte === 0 ? 2 : 1;
    if (size > KV_PORTABLE_LIMITS.maxKeyBytes) return size;
  }
  return size;
}

function assertPortableKeySize(key: readonly string[], label: string): void {
  if (portableKeySize(key) > KV_PORTABLE_LIMITS.maxKeyBytes) {
    invalidArgument(`${label} exceeds the portable size limit`);
  }
}

export function normalizeKvKey(value: unknown, label = "KV key"): string[] {
  const key = snapshotStringKey(value);
  if (!key) invalidArgument(`${label} must be a non-empty array of strings`);
  assertPortableKeySize(key, label);
  return key;
}

export function encodeKvKey(value: unknown, label?: string): string {
  return JSON.stringify(normalizeKvKey(value, label));
}

function normalizeKvSelectorKey(value: unknown, label: string): string[] {
  const key = snapshotStringKey(value, true);
  if (!key) invalidArgument(`${label} must be an array of strings`);
  assertPortableKeySize(key, label);
  return key;
}

export function decodeStoredKvKey(encodedKey: unknown): string[] {
  if (typeof encodedKey !== "string") {
    throw PLATFORM_ERROR.create({ message: "Stored KV key is invalid" });
  }

  try {
    const key = snapshotStringKey(JSON.parse(encodedKey));
    if (key && portableKeySize(key) <= KV_PORTABLE_LIMITS.maxKeyBytes) return key;
  } catch {
    // The provider value is intentionally omitted from the public error.
  }
  throw PLATFORM_ERROR.create({ message: "Stored KV key is invalid" });
}

interface JsonSnapshotState {
  ancestors: WeakSet<object>;
  nodes: number;
}

function snapshotJsonValue(
  value: unknown,
  state: JsonSnapshotState,
  depth = 0,
): KvJsonValue {
  state.nodes++;
  if (state.nodes > KV_PORTABLE_LIMITS.maxValueNodes || depth > KV_PORTABLE_LIMITS.maxValueDepth) {
    throw new TypeError("KV value is too complex");
  }

  if (value === null) return null;
  switch (typeof value) {
    case "boolean":
    case "string":
      if (typeof value === "string") {
        if (value.length > KV_PORTABLE_LIMITS.maxValueBytes) {
          throw new TypeError("KV string is too large");
        }
        if (!isWellFormedUnicode(value)) {
          throw new TypeError("KV value contains malformed Unicode");
        }
      }
      return value;
    case "number":
      if (!Number.isFinite(value) || Object.is(value, -0)) {
        throw new TypeError("KV value contains a number that JSON cannot preserve");
      }
      return value;
    case "object":
      break;
    default:
      throw new TypeError("KV value is outside the JSON value domain");
  }

  if (state.ancestors.has(value)) throw new TypeError("KV value is cyclic");
  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const length = value.length;
      if (length > KV_PORTABLE_LIMITS.maxValueNodes) throw new TypeError("KV array is too large");
      const ownKeys = Reflect.ownKeys(value);
      if (
        ownKeys.length !== length + 1 ||
        ownKeys.some((key) => key !== "length" && !/^\d+$/.test(String(key)))
      ) {
        throw new TypeError("KV arrays must be dense and contain no custom properties");
      }

      const snapshot = new Array<KvJsonValue>(length);
      for (let index = 0; index < length; index++) {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new TypeError("KV arrays must be dense data arrays");
        }
        snapshot[index] = snapshotJsonValue(descriptor.value, state, depth + 1);
      }
      return snapshot;
    }

    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("KV objects must have a plain prototype");
    }

    const snapshot = Object.create(null) as Record<string, KvJsonValue>;
    for (const key of Reflect.ownKeys(value)) {
      if (
        typeof key !== "string" || key.length > KV_PORTABLE_LIMITS.maxValueBytes ||
        !isWellFormedUnicode(key)
      ) {
        throw new TypeError("KV objects must use well-formed string keys");
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError("KV objects must contain enumerable data properties");
      }
      snapshot[key] = snapshotJsonValue(descriptor.value, state, depth + 1);
    }
    return snapshot;
  } finally {
    state.ancestors.delete(value);
  }
}

export function encodeKvValue(value: unknown): string {
  try {
    const snapshot = snapshotJsonValue(value, { ancestors: new WeakSet(), nodes: 0 });
    const encoded = JSON.stringify(snapshot);
    if (textEncoder.encode(encoded).byteLength <= KV_PORTABLE_LIMITS.maxValueBytes) return encoded;
  } catch {
    // The rejected value is intentionally omitted from the public error.
  }
  throw INVALID_ARGUMENT.create({ message: "KV value must be JSON-serializable" });
}

export function decodeStoredKvValue<T>(encodedValue: unknown): T {
  if (typeof encodedValue !== "string") {
    throw PLATFORM_ERROR.create({ message: "Stored KV value is invalid" });
  }
  if (
    encodedValue.length > KV_PORTABLE_LIMITS.maxValueBytes ||
    textEncoder.encode(encodedValue).byteLength > KV_PORTABLE_LIMITS.maxValueBytes
  ) {
    throw PLATFORM_ERROR.create({ message: "Stored KV value is invalid" });
  }

  try {
    const parsed = JSON.parse(encodedValue) as unknown;
    const snapshot = snapshotJsonValue(parsed, { ancestors: new WeakSet(), nodes: 0 });
    const canonical = JSON.stringify(snapshot);
    if (textEncoder.encode(canonical).byteLength <= KV_PORTABLE_LIMITS.maxValueBytes) {
      return parsed as T;
    }
  } catch {
    // The provider value is intentionally omitted from the public error.
  }
  throw PLATFORM_ERROR.create({ message: "Stored KV value is invalid" });
}

export function normalizeKvListOptions(
  options?: KvListOptions,
): NormalizedKvListOptions {
  if (options === undefined) {
    return { maxScanEntries: KV_PORTABLE_LIMITS.defaultListScanEntries, reverse: false };
  }
  if (typeof options !== "object" || options === null) {
    invalidArgument("KV list options must be an object");
  }

  let optionsIsArray: boolean;
  try {
    optionsIsArray = Array.isArray(options);
  } catch {
    invalidArgument("KV list options must be readable");
  }
  if (optionsIsArray) invalidArgument("KV list options must be an object");

  let rawPrefix: unknown;
  let rawStart: unknown;
  let rawEnd: unknown;
  let rawLimit: unknown;
  let rawMaxScanEntries: unknown;
  let rawReverse: unknown;
  try {
    rawPrefix = Reflect.get(options, "prefix");
    rawStart = Reflect.get(options, "start");
    rawEnd = Reflect.get(options, "end");
    rawLimit = Reflect.get(options, "limit");
    rawMaxScanEntries = Reflect.get(options, "maxScanEntries");
    rawReverse = Reflect.get(options, "reverse");
  } catch {
    invalidArgument("KV list options must be readable");
  }

  const prefix = rawPrefix === undefined
    ? undefined
    : normalizeKvSelectorKey(rawPrefix, "KV list prefix");
  const start = rawStart === undefined
    ? undefined
    : normalizeKvSelectorKey(rawStart, "KV list start");
  const end = rawEnd === undefined ? undefined : normalizeKvSelectorKey(rawEnd, "KV list end");

  if (
    rawLimit !== undefined &&
    (!Number.isSafeInteger(rawLimit) || (rawLimit as number) < 0)
  ) {
    invalidArgument("KV list limit must be a non-negative safe integer");
  }
  const maxScanEntries = rawMaxScanEntries ?? KV_PORTABLE_LIMITS.defaultListScanEntries;
  if (
    !Number.isSafeInteger(maxScanEntries) ||
    (maxScanEntries as number) < 1 ||
    (maxScanEntries as number) > KV_PORTABLE_LIMITS.maxListScanEntries
  ) {
    invalidArgument(
      `KV list maxScanEntries must be an integer between 1 and ${KV_PORTABLE_LIMITS.maxListScanEntries}`,
    );
  }
  if (rawLimit !== undefined && (rawLimit as number) > (maxScanEntries as number)) {
    invalidArgument("KV list limit must not exceed maxScanEntries");
  }
  if (rawReverse !== undefined && typeof rawReverse !== "boolean") {
    invalidArgument("KV list reverse must be a boolean");
  }
  if (start && end && compareEncodedKvKeys(JSON.stringify(start), JSON.stringify(end)) > 0) {
    invalidArgument("KV list start must not be greater than end");
  }

  return {
    prefix,
    start,
    end,
    limit: rawLimit as number | undefined,
    maxScanEntries: maxScanEntries as number,
    reverse: rawReverse as boolean | undefined ?? false,
  };
}

export function assertKvListScanWithinLimit(
  scannedEntries: number,
  maxScanEntries: number,
): void {
  if (scannedEntries <= maxScanEntries) return;
  throw PLATFORM_ERROR.create({
    message: "KV list scan exceeded maxScanEntries; narrow the selector or increase maxScanEntries",
  });
}

function isStrictDescendant(key: string[], prefix: string[]): boolean {
  if (key.length <= prefix.length) return false;
  for (let index = 0; index < prefix.length; index++) {
    if (key[index] !== prefix[index]) return false;
  }
  return true;
}

export function matchesKvListOptions<T>(
  entry: SelectableKvEntry<T>,
  options: NormalizedKvListOptions,
): boolean {
  if (options.prefix && !isStrictDescendant(entry.key, options.prefix)) return false;
  const encodedStart = options.start && JSON.stringify(options.start);
  const encodedEnd = options.end && JSON.stringify(options.end);
  if (encodedStart && compareEncodedKvKeys(entry.encodedKey, encodedStart) < 0) return false;
  if (encodedEnd && compareEncodedKvKeys(entry.encodedKey, encodedEnd) >= 0) return false;
  return true;
}

export function selectKvEntries<T>(
  entries: Iterable<SelectableKvEntry<T>>,
  options: NormalizedKvListOptions,
): SelectableKvEntry<T>[] {
  const selected = [...entries].filter((entry) => matchesKvListOptions(entry, options));

  selected.sort((left, right) => compareEncodedKvKeys(left.encodedKey, right.encodedKey));
  if (options.reverse) selected.reverse();
  return options.limit === undefined ? selected : selected.slice(0, options.limit);
}

export function assertKvOpen(closed: boolean): void {
  if (closed) throw PLATFORM_ERROR.create({ message: "KV store is closed" });
}

export class VersionstampGenerator {
  private lastVersionstamp = 0n;

  nextSequence(): string {
    const clockVersionstamp = BigInt(Date.now()) * VERSIONSTAMP_TICKS_PER_MILLISECOND;
    this.lastVersionstamp = clockVersionstamp > this.lastVersionstamp
      ? clockVersionstamp
      : this.lastVersionstamp + 1n;
    return this.lastVersionstamp.toString().padStart(VERSIONSTAMP_MINIMUM_WIDTH, "0");
  }

  next(): string {
    return formatKvVersionstamp(this.nextSequence());
  }
}

export function formatKvVersionstamp(sequence: string): string {
  if (!/^\d{20}$/.test(sequence)) throw new TypeError("Invalid KV versionstamp sequence");
  return `${VERSIONSTAMP_FORMAT_PREFIX}${sequence}`;
}
