import { isProxyWithoutHooks } from "../compat/error-introspection.ts";

const apply = Reflect.apply;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const objectHasOwnProperty = Object.prototype.hasOwnProperty;
const createObject = Object.create;
const freezeObject = Object.freeze;
const isArray = Array.isArray;
const numberIsSafeInteger = Number.isSafeInteger;
const universalObjectPrototype = Object.prototype;
const NativeUint8Array = Uint8Array;
const typedArrayPrototype = getPrototypeOf(NativeUint8Array.prototype);
const typedArrayBufferGetter = requireIntrinsicGetter(
  typedArrayPrototype,
  "buffer",
  "Uint8Array buffer",
);
const typedArrayByteLengthGetter = requireIntrinsicGetter(
  typedArrayPrototype,
  "byteLength",
  "Uint8Array byteLength",
);
const typedArrayByteOffsetGetter = requireIntrinsicGetter(
  typedArrayPrototype,
  "byteOffset",
  "Uint8Array byte offset",
);
const typedArrayNameGetter = requireIntrinsicGetter(
  typedArrayPrototype,
  Symbol.toStringTag,
  "Uint8Array name",
);
const arrayBufferByteLengthGetter = requireIntrinsicGetter(
  ArrayBuffer.prototype,
  "byteLength",
  "ArrayBuffer byteLength",
);
const arrayBufferResizableGetter = getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "resizable",
)?.get;
const setBytes = NativeUint8Array.prototype.set;
const ABSENT_CAPABILITY = Symbol("absent filesystem capability");
const INVALID_CAPABILITY = Symbol("invalid filesystem capability");

const LEGACY_CAPABILITY_KEYS = [
  "readFileBytes",
  "readFileBytesBounded",
  "readFileBytesWithinLimit",
  "writeFileBytes",
  "maxWholeFileReadBytes",
] as const;
const BOUNDED_TEXT_CAPABILITY_KEYS = [
  "readFileBytes",
  "readFileBytesWithinLimit",
  "maxWholeFileReadBytes",
] as const;
const BYTE_READ_CAPABILITY_KEYS = [
  "readFileBytes",
  "readFileBytesBounded",
  "readFileBytesWithinLimit",
  "maxWholeFileReadBytes",
] as const;
const SNAPSHOT_CAPABILITY_KEYS = ["readFileSnapshotWithinLimit"] as const;
const EXCLUSIVE_CREATE_CAPABILITY_KEYS = ["createFileBytesExclusive"] as const;
const GENERATION_CAPABILITY_KEYS = ["getSourceSnapshotVersion"] as const;
const VIRTUAL_READ_CAPABILITY_KEYS = [
  "readFileBytes",
  "readFileBytesWithinLimit",
  "maxWholeFileReadBytes",
] as const;

type CapabilityKey =
  | (typeof LEGACY_CAPABILITY_KEYS)[number]
  | (typeof SNAPSHOT_CAPABILITY_KEYS)[number]
  | (typeof EXCLUSIVE_CREATE_CAPABILITY_KEYS)[number]
  | (typeof GENERATION_CAPABILITY_KEYS)[number];
type ByteReader = (path: string) => Promise<Uint8Array>;
type BoundedByteReader = (path: string, byteLimit: number) => Promise<Uint8Array>;
type SnapshotByteReader = (
  path: string,
  containmentRoot: string,
  byteLimit: number,
) => Promise<Uint8Array>;
type ByteWriter = (path: string, content: Uint8Array) => Promise<void>;
type SnapshotVersionReader = () => number | undefined | Promise<number | undefined>;

export interface CapturedWholeFileReader {
  readonly maximumBytes: number;
  readonly read: ByteReader;
}

export interface CapturedFileSystemCapabilities {
  readonly readFileBytes?: ByteReader;
  readonly readFileBytesBounded?: BoundedByteReader;
  readonly readFileBytesWithinLimit?: BoundedByteReader;
  readonly writeFileBytes?: ByteWriter;
  readonly wholeFileReader?: CapturedWholeFileReader;
}

/** Compatibility view used by existing filesystem wrappers and adapters. */
export interface CapturedByteReaders {
  readonly unbounded?: ByteReader;
  readonly whole?: CapturedWholeFileReader;
  readonly prefix?: BoundedByteReader;
  readonly exact?: BoundedByteReader;
}

export interface CapturedSnapshotReader {
  read(
    path: string,
    containmentRoot: string,
    byteLimit: number,
  ): Promise<Uint8Array>;
}

export interface CapturedExclusiveCreator {
  create(path: string, content: Uint8Array): Promise<void>;
}

export interface CapturedStaticReaders {
  snapshot?: CapturedSnapshotReader;
  virtual?: {
    generation(): Promise<number>;
    exact?: (path: string, byteLimit: number) => Promise<Uint8Array>;
    whole?: { maximumBytes: number; read(path: string): Promise<Uint8Array> };
  };
}

function hasOwn(value: PropertyDescriptor, key: PropertyKey): boolean {
  return apply(objectHasOwnProperty, value, [key]) as boolean;
}

function requireIntrinsicGetter(
  target: object,
  property: PropertyKey,
  name: string,
): (this: object) => unknown {
  const descriptor = getOwnPropertyDescriptor(target, property);
  const getter = descriptor !== undefined && hasOwn(descriptor, "get") ? descriptor.get : undefined;
  if (typeof getter !== "function") {
    throw new TypeError(`Required ${name} intrinsic is unavailable`);
  }
  return getter;
}

function invalidCapability(label: string, detail: string, cause?: unknown): TypeError {
  return cause === undefined
    ? new TypeError(`${label} ${detail}`)
    : new TypeError(`${label} ${detail}`, { cause });
}

function requireCapabilityObject(value: unknown, label: string): asserts value is object {
  if (
    typeof value !== "object" ||
    value === null ||
    isProxyWithoutHooks(value) ||
    isArray(value)
  ) {
    throw invalidCapability(label, "must be a non-array, non-Proxy object");
  }
}

function captureDataProperties(
  value: object,
  label: string,
  keys: readonly CapabilityKey[],
  invalidFieldPolicy: "reject" | "quarantine" = "reject",
): Readonly<Record<CapabilityKey, unknown>> {
  const properties = createObject(null) as Record<CapabilityKey, unknown>;
  const resolved = createObject(null) as Record<CapabilityKey, boolean>;
  let remaining = keys.length;
  let owner: object | null = value;
  const seen = new Set<object>();

  for (let depth = 0; owner !== null && depth < 64; depth++) {
    if (owner === universalObjectPrototype) {
      owner = null;
      break;
    }
    if (isProxyWithoutHooks(owner)) {
      throw invalidCapability(label, "capabilities must not use a Proxy");
    }
    if (seen.has(owner)) {
      throw invalidCapability(label, "capabilities have an invalid prototype chain");
    }
    seen.add(owner);

    let parent: object | null;
    try {
      parent = getPrototypeOf(owner);
    } catch (cause) {
      throw invalidCapability(label, "capabilities could not be inspected safely", cause);
    }
    // A foreign realm's Object.prototype is identified by its terminal
    // position rather than by local identity and is never adapter authority.
    if (owner !== value && parent === null) {
      owner = null;
      break;
    }

    for (let index = 0; index < keys.length; index++) {
      const key = keys[index]!;
      if (resolved[key]) continue;
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = getOwnPropertyDescriptor(owner, key);
      } catch (cause) {
        throw invalidCapability(label, "capabilities could not be inspected safely", cause);
      }
      if (descriptor === undefined) continue;
      resolved[key] = true;
      remaining--;
      if (!hasOwn(descriptor, "value")) {
        if (invalidFieldPolicy === "reject") {
          throw invalidCapability(
            label,
            key === "maxWholeFileReadBytes"
              ? `${key} must be a data property`
              : `${key} must be a data-property method`,
          );
        }
        properties[key] = INVALID_CAPABILITY;
        continue;
      }
      properties[key] = descriptor.value;
    }

    if (remaining === 0) {
      owner = null;
      break;
    }
    owner = parent;
  }

  if (owner !== null && remaining > 0) {
    throw invalidCapability(label, "capability prototype chain is too deep");
  }
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    if (!resolved[key]) properties[key] = ABSENT_CAPABILITY;
  }
  return freezeObject(properties);
}

function requireOptionalMethod<T>(
  candidate: unknown,
  label: string,
  key: CapabilityKey,
  allowExplicitUndefined = true,
): T | undefined {
  if (
    candidate === ABSENT_CAPABILITY ||
    (allowExplicitUndefined && candidate === undefined)
  ) return undefined;
  if (typeof candidate !== "function" || isProxyWithoutHooks(candidate)) {
    throw invalidCapability(label, `${key} must be a non-Proxy function`);
  }
  return candidate as T;
}

function getUint8ArrayByteLength(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    if (apply(typedArrayNameGetter, value, []) !== "Uint8Array") return undefined;
    const byteLength = apply(typedArrayByteLengthGetter, value, []);
    return typeof byteLength === "number" && numberIsSafeInteger(byteLength) && byteLength >= 0
      ? byteLength
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Admit an untrusted byte result before copying it into an immutable-size,
 * tightly allocated ArrayBuffer. The maximum is checked from the intrinsic
 * Uint8Array byte length before allocating the defensive copy.
 */
export function copyFixedUint8ArrayWithinLimit(
  value: unknown,
  maximumBytes: number,
  label: string,
): Uint8Array {
  if (!numberIsSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new RangeError(`${label} maximum must be a positive safe integer`);
  }
  const byteLength = getUint8ArrayByteLength(value);
  if (byteLength === undefined) {
    throw new TypeError(`${label} reader returned invalid bytes`);
  }
  // Size overflow is a RangeError across the bounded-read surface; a malformed
  // or dishonest result type stays a TypeError. Boundaries that present a
  // different class to their own callers normalize this cause themselves.
  if (byteLength > maximumBytes) {
    throw new RangeError(`${label} exceeds ${maximumBytes} bytes`);
  }

  let buffer: unknown;
  let resizable = false;
  try {
    buffer = apply(typedArrayBufferGetter, value as object, []);
    apply(arrayBufferByteLengthGetter, buffer as object, []);
    resizable = arrayBufferResizableGetter !== undefined &&
      apply(arrayBufferResizableGetter, buffer as object, []) === true;
  } catch (cause) {
    throw new TypeError(`${label} reader must return bytes backed by a fixed ArrayBuffer`, {
      cause,
    });
  }
  if (resizable) {
    throw new TypeError(`${label} reader must return bytes backed by a fixed ArrayBuffer`);
  }

  const copy = new NativeUint8Array(byteLength);
  try {
    apply(setBytes, copy, [value]);
  } catch (cause) {
    throw new TypeError(`${label} reader returned invalid bytes`, { cause });
  }
  let copyByteLength: unknown;
  let copyByteOffset: unknown;
  let copyBuffer: unknown;
  let copyBufferByteLength: unknown;
  try {
    copyByteLength = apply(typedArrayByteLengthGetter, copy, []);
    copyByteOffset = apply(typedArrayByteOffsetGetter, copy, []);
    copyBuffer = apply(typedArrayBufferGetter, copy, []);
    copyBufferByteLength = apply(arrayBufferByteLengthGetter, copyBuffer as object, []);
  } catch (cause) {
    throw new TypeError(`${label} could not allocate a fixed byte copy`, { cause });
  }
  if (
    copyByteLength !== byteLength ||
    copyByteOffset !== 0 ||
    copyBufferByteLength !== byteLength
  ) {
    throw new TypeError(`${label} could not allocate a tight fixed byte copy`);
  }
  return copy;
}

/**
 * Extract the ArrayBuffer from an admitted tight fixed Uint8Array without
 * consulting mutable global constructors or configurable typed-array getters.
 */
export function getFixedUint8ArrayBuffer(value: unknown, label: string): ArrayBuffer {
  const byteLength = getUint8ArrayByteLength(value);
  if (byteLength === undefined) {
    throw new TypeError(`${label} must be a Uint8Array`);
  }
  let byteOffset: unknown;
  let buffer: unknown;
  let bufferByteLength: unknown;
  let resizable = false;
  try {
    byteOffset = apply(typedArrayByteOffsetGetter, value as object, []);
    buffer = apply(typedArrayBufferGetter, value as object, []);
    bufferByteLength = apply(arrayBufferByteLengthGetter, buffer as object, []);
    resizable = arrayBufferResizableGetter !== undefined &&
      apply(arrayBufferResizableGetter, buffer as object, []) === true;
  } catch (cause) {
    throw new TypeError(`${label} must use a tight fixed ArrayBuffer`, { cause });
  }
  if (byteOffset !== 0 || bufferByteLength !== byteLength || resizable) {
    throw new TypeError(`${label} must use a tight fixed ArrayBuffer`);
  }
  return buffer as ArrayBuffer;
}

/** Read the intrinsic byte length only after verifying a tight fixed buffer. */
export function getFixedUint8ArrayByteLength(value: unknown, label: string): number {
  const byteLength = getUint8ArrayByteLength(value);
  if (byteLength === undefined) {
    throw new TypeError(`${label} must be a Uint8Array`);
  }
  getFixedUint8ArrayBuffer(value, label);
  return byteLength;
}

function copyExclusiveCreateBytes(content: unknown, label: string): Uint8Array {
  const byteLength = getUint8ArrayByteLength(content);
  if (byteLength === undefined) {
    throw invalidCapability(label, "create content must be a Uint8Array");
  }
  return copyFixedUint8ArrayWithinLimit(
    content,
    byteLength === 0 ? 1 : byteLength,
    `${label} create content`,
  );
}

function requirePositiveByteLimit(value: unknown, label: string): number {
  if (!numberIsSafeInteger(value) || (value as number) <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value as number;
}

function requireGeneration(value: unknown, label: string): number {
  if (!numberIsSafeInteger(value) || (value as number) < 0) {
    throw invalidCapability(label, "generation must be a non-negative safe integer");
  }
  return value as number;
}

function captureWholeFileReader(
  value: object,
  properties: Readonly<Record<CapabilityKey, unknown>>,
  label: string,
  defensiveResults: boolean,
  allowExplicitUndefined: boolean,
): CapturedWholeFileReader | undefined {
  const rawReadFileBytes = requireOptionalMethod<ByteReader>(
    properties.readFileBytes,
    label,
    "readFileBytes",
    allowExplicitUndefined,
  );
  const ceilingCandidate = properties.maxWholeFileReadBytes;
  const ceiling = ceilingCandidate === ABSENT_CAPABILITY ||
      (allowExplicitUndefined && ceilingCandidate === undefined)
    ? undefined
    : ceilingCandidate;
  if (ceiling !== undefined && (!numberIsSafeInteger(ceiling) || (ceiling as number) <= 0)) {
    throw invalidCapability(label, "maxWholeFileReadBytes must be a positive safe integer");
  }
  if (ceiling !== undefined && rawReadFileBytes === undefined) {
    throw invalidCapability(label, "maxWholeFileReadBytes requires readFileBytes");
  }
  if (ceiling === undefined || rawReadFileBytes === undefined) return undefined;

  const maximumBytes = ceiling as number;
  const read = defensiveResults
    ? async (path: string): Promise<Uint8Array> => {
      const result = await apply(rawReadFileBytes, value, [path]);
      return copyFixedUint8ArrayWithinLimit(result, maximumBytes, `${label} whole-file`);
    }
    : (path: string) => apply(rawReadFileBytes, value, [path]) as Promise<Uint8Array>;
  const captured = createObject(null) as { maximumBytes: number; read: ByteReader };
  captured.maximumBytes = maximumBytes;
  captured.read = read;
  return freezeObject(captured);
}

/**
 * Preserve the broad legacy capture temporarily for its scheduled consumers.
 * Bounded text passes the narrow purpose so writer and prefix fields are never
 * inspected.
 */
export function captureFileSystemCapabilities(
  value: unknown,
  label = "Filesystem",
  purpose: "legacy" | "bounded-text" | "byte-read" = "legacy",
): CapturedFileSystemCapabilities {
  requireCapabilityObject(value, label);
  const keys = purpose === "bounded-text"
    ? BOUNDED_TEXT_CAPABILITY_KEYS
    : purpose === "byte-read"
    ? BYTE_READ_CAPABILITY_KEYS
    : LEGACY_CAPABILITY_KEYS;
  const properties = captureDataProperties(value, label, keys);
  const rawReadFileBytes = requireOptionalMethod<ByteReader>(
    properties.readFileBytes,
    label,
    "readFileBytes",
  );
  const rawBoundedReader = purpose === "bounded-text"
    ? undefined
    : requireOptionalMethod<BoundedByteReader>(
      properties.readFileBytesBounded,
      label,
      "readFileBytesBounded",
    );
  const rawExactReader = requireOptionalMethod<BoundedByteReader>(
    properties.readFileBytesWithinLimit,
    label,
    "readFileBytesWithinLimit",
  );
  const rawWriter = purpose !== "legacy" ? undefined : requireOptionalMethod<ByteWriter>(
    properties.writeFileBytes,
    label,
    "writeFileBytes",
  );

  const readFileBytes = rawReadFileBytes === undefined
    ? undefined
    : (path: string) => apply(rawReadFileBytes, value, [path]) as Promise<Uint8Array>;
  const readFileBytesBounded = rawBoundedReader === undefined
    ? undefined
    : (path: string, byteLimit: number) =>
      apply(rawBoundedReader, value, [path, byteLimit]) as Promise<Uint8Array>;
  const readFileBytesWithinLimit = rawExactReader === undefined
    ? undefined
    : (path: string, byteLimit: number) =>
      apply(rawExactReader, value, [path, byteLimit]) as Promise<Uint8Array>;
  const writeFileBytes = rawWriter === undefined
    ? undefined
    : (path: string, content: Uint8Array) =>
      apply(rawWriter, value, [path, content]) as Promise<void>;
  const wholeFileReader = captureWholeFileReader(value, properties, label, false, true);

  const captured = createObject(null) as Record<string, unknown>;
  if (readFileBytes !== undefined) captured.readFileBytes = readFileBytes;
  if (readFileBytesBounded !== undefined) captured.readFileBytesBounded = readFileBytesBounded;
  if (readFileBytesWithinLimit !== undefined) {
    captured.readFileBytesWithinLimit = readFileBytesWithinLimit;
  }
  if (writeFileBytes !== undefined) captured.writeFileBytes = writeFileBytes;
  if (wholeFileReader !== undefined) captured.wholeFileReader = wholeFileReader;
  return freezeObject(captured) as CapturedFileSystemCapabilities;
}

/**
 * Capture the established byte-reader surface while defensively admitting
 * every result. New purpose-specific code should prefer the narrower capture
 * functions above.
 */
export function captureByteReadCapabilities(
  value: unknown,
  label = "Filesystem",
): CapturedByteReaders {
  const capabilities = captureFileSystemCapabilities(value, label, "byte-read");
  const captured = createObject(null) as {
    unbounded?: ByteReader;
    whole?: CapturedWholeFileReader;
    prefix?: BoundedByteReader;
    exact?: BoundedByteReader;
  };

  if (capabilities.readFileBytes !== undefined) {
    captured.unbounded = async (path: string): Promise<Uint8Array> =>
      copyFixedUint8ArrayWithinLimit(
        await capabilities.readFileBytes!(path),
        Number.MAX_SAFE_INTEGER,
        `${label} whole-file`,
      );
  }
  if (capabilities.wholeFileReader !== undefined) {
    const rawWhole = capabilities.wholeFileReader;
    const whole = createObject(null) as {
      maximumBytes: number;
      read: ByteReader;
    };
    whole.maximumBytes = rawWhole.maximumBytes;
    whole.read = async (path: string): Promise<Uint8Array> =>
      copyFixedUint8ArrayWithinLimit(
        await rawWhole.read(path),
        rawWhole.maximumBytes,
        `${label} whole-file`,
      );
    captured.whole = freezeObject(whole);
  }
  if (capabilities.readFileBytesBounded !== undefined) {
    captured.prefix = async (path: string, byteLimit: number): Promise<Uint8Array> => {
      const limit = requirePositiveByteLimit(byteLimit, `${label} prefix byte limit`);
      return copyFixedUint8ArrayWithinLimit(
        await capabilities.readFileBytesBounded!(path, limit),
        limit,
        `${label} prefix`,
      );
    };
  }
  if (capabilities.readFileBytesWithinLimit !== undefined) {
    captured.exact = async (path: string, byteLimit: number): Promise<Uint8Array> => {
      const limit = requirePositiveByteLimit(byteLimit, `${label} exact byte limit`);
      return copyFixedUint8ArrayWithinLimit(
        await capabilities.readFileBytesWithinLimit!(path, limit),
        limit,
        `${label} exact`,
      );
    };
  }
  return freezeObject(captured);
}

function admitQuarantinedMethod<T>(candidate: unknown): T | undefined {
  if (
    candidate === ABSENT_CAPABILITY ||
    candidate === INVALID_CAPABILITY ||
    candidate === undefined ||
    typeof candidate !== "function" ||
    isProxyWithoutHooks(candidate)
  ) {
    return undefined;
  }
  return candidate as T;
}

/**
 * Capture legacy byte capabilities after genuine snapshot authority has been
 * proven independently. Malformed optional fields are omitted one at a time;
 * unsafe object or prototype provenance still rejects the adapter.
 */
export function captureLegacyFileSystemCapabilitiesForSnapshot(
  value: unknown,
  label = "Filesystem",
): CapturedFileSystemCapabilities {
  requireCapabilityObject(value, label);
  const properties = captureDataProperties(
    value,
    label,
    LEGACY_CAPABILITY_KEYS,
    "quarantine",
  );
  const rawReadFileBytes = admitQuarantinedMethod<ByteReader>(properties.readFileBytes);
  const rawBoundedReader = admitQuarantinedMethod<BoundedByteReader>(
    properties.readFileBytesBounded,
  );
  const rawExactReader = admitQuarantinedMethod<BoundedByteReader>(
    properties.readFileBytesWithinLimit,
  );
  const rawWriter = admitQuarantinedMethod<ByteWriter>(properties.writeFileBytes);
  const ceilingCandidate = properties.maxWholeFileReadBytes;
  const maximumBytes = numberIsSafeInteger(ceilingCandidate) &&
      (ceilingCandidate as number) > 0
    ? ceilingCandidate as number
    : undefined;

  const captured = createObject(null) as Record<string, unknown>;
  if (rawReadFileBytes !== undefined) {
    const readFileBytes = (path: string) =>
      apply(rawReadFileBytes, value, [path]) as Promise<Uint8Array>;
    captured.readFileBytes = readFileBytes;
    if (maximumBytes !== undefined) {
      const wholeFileReader = createObject(null) as {
        maximumBytes: number;
        read: ByteReader;
      };
      wholeFileReader.maximumBytes = maximumBytes;
      wholeFileReader.read = readFileBytes;
      captured.wholeFileReader = freezeObject(wholeFileReader);
    }
  }
  if (rawBoundedReader !== undefined) {
    captured.readFileBytesBounded = (path: string, byteLimit: number) =>
      apply(rawBoundedReader, value, [path, byteLimit]) as Promise<Uint8Array>;
  }
  if (rawExactReader !== undefined) {
    captured.readFileBytesWithinLimit = (path: string, byteLimit: number) =>
      apply(rawExactReader, value, [path, byteLimit]) as Promise<Uint8Array>;
  }
  if (rawWriter !== undefined) {
    captured.writeFileBytes = (path: string, content: Uint8Array) =>
      apply(rawWriter, value, [path, content]) as Promise<void>;
  }
  return freezeObject(captured) as CapturedFileSystemCapabilities;
}

export function captureSnapshotReadCapability(
  value: unknown,
  label = "Filesystem",
  allowExplicitUndefined = false,
): CapturedSnapshotReader | undefined {
  requireCapabilityObject(value, label);
  const properties = captureDataProperties(value, label, SNAPSHOT_CAPABILITY_KEYS);
  const rawReader = requireOptionalMethod<SnapshotByteReader>(
    properties.readFileSnapshotWithinLimit,
    label,
    "readFileSnapshotWithinLimit",
    allowExplicitUndefined,
  );
  if (rawReader === undefined) return undefined;

  const captured = createObject(null) as CapturedSnapshotReader;
  captured.read = async (
    path: string,
    containmentRoot: string,
    byteLimit: number,
  ): Promise<Uint8Array> => {
    requirePositiveByteLimit(byteLimit, `${label} snapshot byte limit`);
    const result = await apply(rawReader, value, [path, containmentRoot, byteLimit]);
    return copyFixedUint8ArrayWithinLimit(result, byteLimit, `${label} snapshot`);
  };
  return freezeObject(captured);
}

export function captureExclusiveCreateCapability(
  value: unknown,
  label = "Filesystem",
): CapturedExclusiveCreator | undefined {
  requireCapabilityObject(value, label);
  const properties = captureDataProperties(value, label, EXCLUSIVE_CREATE_CAPABILITY_KEYS);
  const rawCreator = requireOptionalMethod<ByteWriter>(
    properties.createFileBytesExclusive,
    label,
    "createFileBytesExclusive",
    false,
  );
  if (rawCreator === undefined) return undefined;

  const captured = createObject(null) as CapturedExclusiveCreator;
  captured.create = (path: string, content: Uint8Array): Promise<void> => {
    const fixedContent = copyExclusiveCreateBytes(content, label);
    return apply(rawCreator, value, [path, fixedContent]) as Promise<void>;
  };
  return freezeObject(captured);
}

/**
 * Capture snapshot and virtual read authority from a filesystem.
 *
 * `allowExplicitUndefined` stays strict by default, matching
 * {@link captureSnapshotReadCapability}: for a raw adapter, a capability key
 * present with the value `undefined` is a defect worth surfacing.
 *
 * Callers handed an `FSAdapterWrapper` must opt in, because that wrapper
 * publishes every optional capability as a frozen own property, `undefined`
 * included, so project code cannot inject one later. Without the opt-in this
 * threw, and its only caller wraps it in a catch, so wrapper-backed
 * filesystems silently lost virtual snapshot authority instead of failing.
 */
export function captureStaticReadCapabilities(
  value: unknown,
  label = "Filesystem",
  allowExplicitUndefined = false,
): CapturedStaticReaders {
  requireCapabilityObject(value, label);
  const snapshot = captureSnapshotReadCapability(value, label, allowExplicitUndefined);
  const captured = createObject(null) as CapturedStaticReaders;
  if (snapshot !== undefined) captured.snapshot = snapshot;

  // Virtual readers are authority only behind an explicit own data marker.
  // An absent, inherited, or accessor marker leaves unrelated fields unobserved.
  const semantics = getOwnPropertyDescriptor(value, "symlinkSemantics");
  if (
    semantics === undefined ||
    !hasOwn(semantics, "value") ||
    semantics.value !== "none"
  ) {
    return freezeObject(captured);
  }

  const generationProperties = captureDataProperties(
    value,
    label,
    GENERATION_CAPABILITY_KEYS,
  );
  const rawGeneration = requireOptionalMethod<SnapshotVersionReader>(
    generationProperties.getSourceSnapshotVersion,
    label,
    "getSourceSnapshotVersion",
    allowExplicitUndefined,
  );
  if (rawGeneration === undefined) return freezeObject(captured);

  const readerProperties = captureDataProperties(
    value,
    label,
    VIRTUAL_READ_CAPABILITY_KEYS,
  );
  const rawExactReader = requireOptionalMethod<BoundedByteReader>(
    readerProperties.readFileBytesWithinLimit,
    label,
    "readFileBytesWithinLimit",
    allowExplicitUndefined,
  );
  const whole = captureWholeFileReader(value, readerProperties, label, true, false);
  const virtual = createObject(null) as NonNullable<CapturedStaticReaders["virtual"]>;
  virtual.generation = async (): Promise<number> => {
    const result = await apply(rawGeneration, value, []);
    return requireGeneration(result, label);
  };
  if (rawExactReader !== undefined) {
    virtual.exact = async (path: string, byteLimit: number): Promise<Uint8Array> => {
      requirePositiveByteLimit(byteLimit, `${label} exact byte limit`);
      const result = await apply(rawExactReader, value, [path, byteLimit]);
      return copyFixedUint8ArrayWithinLimit(result, byteLimit, `${label} exact`);
    };
  }
  if (whole !== undefined) virtual.whole = whole;
  if (virtual.exact === undefined && virtual.whole === undefined) {
    return freezeObject(captured);
  }
  captured.virtual = freezeObject(virtual);
  return freezeObject(captured);
}
