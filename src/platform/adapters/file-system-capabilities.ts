const apply = Reflect.apply;
const createObject = Object.create;
const freezeObject = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const numberIsSafeInteger = Number.isSafeInteger;
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
  "ArrayBuffer byte length",
);
const arrayBufferResizableGetter = getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "resizable",
)?.get;
const setBytes = NativeUint8Array.prototype.set;

const MAX_CAPABILITY_PROTOTYPE_DEPTH = 64;
const universalObjectPrototype = Object.prototype;

type ByteReader = (path: string) => Promise<Uint8Array>;
type LimitedByteReader = (path: string, byteLimit: number) => Promise<Uint8Array>;
type SnapshotByteReader = (
  path: string,
  containmentRoot: string,
  byteLimit: number,
) => Promise<Uint8Array>;
type ByteWriter = (path: string, content: Uint8Array) => Promise<void>;
type GenerationReader = () => number | undefined | Promise<number | undefined>;

type CapabilityKey =
  | "readFileBytes"
  | "readFileBytesBounded"
  | "readFileBytesWithinLimit"
  | "readFileSnapshotWithinLimit"
  | "createFileBytesExclusive"
  | "maxWholeFileReadBytes"
  | "getSourceSnapshotVersion";

export interface CapturedWholeFileReader {
  readonly maximumBytes: number;
  read(path: string): Promise<Uint8Array>;
}

export interface CapturedByteReaders {
  readonly whole?: CapturedWholeFileReader;
  readonly prefix?: LimitedByteReader;
  readonly exact?: LimitedByteReader;
}

export interface CapturedSnapshotReader {
  read(path: string, containmentRoot: string, byteLimit: number): Promise<Uint8Array>;
}

export interface CapturedExclusiveCreator {
  create(path: string, content: Uint8Array): Promise<void>;
}

export interface CapturedStaticReaders {
  readonly snapshot?: CapturedSnapshotReader;
  readonly virtual?: {
    generation(): Promise<number>;
    readonly exact?: LimitedByteReader;
    readonly whole?: CapturedWholeFileReader;
  };
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return apply(hasOwnProperty, value, [key]) as boolean;
}

function requireIntrinsicGetter(
  target: object,
  property: PropertyKey,
  label: string,
): (this: object) => unknown {
  const descriptor = getOwnPropertyDescriptor(target, property);
  const getter = descriptor && hasOwn(descriptor, "get") ? descriptor.get : undefined;
  if (typeof getter !== "function") {
    throw new TypeError(`Required ${label} intrinsic is unavailable`);
  }
  return getter;
}

function requireCapabilityObject(value: unknown, label: string): asserts value is object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a non-array object`);
  }
}

function captureDataProperties(
  value: object,
  keys: readonly CapabilityKey[],
  label: string,
): Readonly<Partial<Record<CapabilityKey, unknown>>> {
  const result = createObject(null) as Partial<Record<CapabilityKey, unknown>>;
  const unresolved = new Set<CapabilityKey>(keys);
  const seen = new Set<object>();
  let owner: object | null = value;

  for (let depth = 0; owner !== null && depth < MAX_CAPABILITY_PROTOTYPE_DEPTH; depth++) {
    if (owner === universalObjectPrototype) {
      owner = null;
      break;
    }
    if (seen.has(owner)) {
      throw new TypeError(`${label} has an invalid capability prototype chain`);
    }
    seen.add(owner);

    let parent: object | null;
    try {
      parent = getPrototypeOf(owner);
    } catch (cause) {
      throw new TypeError(`${label} capabilities could not be inspected safely`, { cause });
    }
    // Do not treat a foreign realm's terminal Object.prototype as authority.
    if (owner !== value && parent === null) {
      owner = null;
      break;
    }

    for (const key of unresolved) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = getOwnPropertyDescriptor(owner, key);
      } catch (cause) {
        throw new TypeError(`${label} capabilities could not be inspected safely`, { cause });
      }
      if (descriptor === undefined) continue;
      unresolved.delete(key);
      if (!hasOwn(descriptor, "value")) {
        throw new TypeError(`${label} ${key} must be a data property`);
      }
      result[key] = descriptor.value;
    }
    if (unresolved.size === 0) {
      owner = null;
      break;
    }
    owner = parent;
  }

  if (owner !== null && unresolved.size > 0) {
    throw new TypeError(`${label} capability prototype chain is too deep`);
  }
  return freezeObject(result);
}

function optionalMethod<T>(candidate: unknown, label: string, key: string): T | undefined {
  if (candidate === undefined) return undefined;
  if (typeof candidate !== "function") {
    throw new TypeError(`${label} ${key} must be a function`);
  }
  return candidate as T;
}

function positiveSafeInteger(value: unknown, label: string): number {
  if (!numberIsSafeInteger(value) || (value as number) <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value as number;
}

function uint8ArrayByteLength(value: unknown): number | undefined {
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

/** Copy untrusted bytes into a tightly allocated, immutable-size ArrayBuffer. */
export function copyFixedUint8ArrayWithinLimit(
  value: unknown,
  maximumBytes: number,
  label: string,
): Uint8Array {
  positiveSafeInteger(maximumBytes, `${label} maximum`);
  const byteLength = uint8ArrayByteLength(value);
  if (byteLength === undefined) throw new TypeError(`${label} returned invalid bytes`);
  if (byteLength > maximumBytes) throw new RangeError(`${label} exceeds ${maximumBytes} bytes`);

  let buffer: unknown;
  let resizable = false;
  try {
    buffer = apply(typedArrayBufferGetter, value as object, []);
    apply(arrayBufferByteLengthGetter, buffer as object, []);
    resizable = arrayBufferResizableGetter !== undefined &&
      apply(arrayBufferResizableGetter, buffer as object, []) === true;
  } catch (cause) {
    throw new TypeError(`${label} must use a fixed ArrayBuffer`, { cause });
  }
  if (resizable) throw new TypeError(`${label} must use a fixed ArrayBuffer`);

  const copy = new NativeUint8Array(byteLength);
  try {
    apply(setBytes, copy, [value]);
  } catch (cause) {
    throw new TypeError(`${label} returned invalid bytes`, { cause });
  }
  const copyBuffer = apply(typedArrayBufferGetter, copy, []) as object;
  if (
    apply(typedArrayByteOffsetGetter, copy, []) !== 0 ||
    apply(arrayBufferByteLengthGetter, copyBuffer, []) !== byteLength
  ) {
    throw new TypeError(`${label} could not allocate a tight byte copy`);
  }
  return copy;
}

/** Capture only ordinary byte-read authority. Snapshot authority is independent. */
export function captureByteReadCapabilities(
  value: unknown,
  label = "Filesystem",
): CapturedByteReaders {
  requireCapabilityObject(value, label);
  const properties = captureDataProperties(value, [
    "readFileBytes",
    "readFileBytesBounded",
    "readFileBytesWithinLimit",
    "maxWholeFileReadBytes",
  ], label);
  const rawWhole = optionalMethod<ByteReader>(properties.readFileBytes, label, "readFileBytes");
  const rawPrefix = optionalMethod<LimitedByteReader>(
    properties.readFileBytesBounded,
    label,
    "readFileBytesBounded",
  );
  const rawExact = optionalMethod<LimitedByteReader>(
    properties.readFileBytesWithinLimit,
    label,
    "readFileBytesWithinLimit",
  );
  const ceiling = properties.maxWholeFileReadBytes === undefined
    ? undefined
    : positiveSafeInteger(properties.maxWholeFileReadBytes, `${label} maxWholeFileReadBytes`);
  if (ceiling !== undefined && rawWhole === undefined) {
    throw new TypeError(`${label} maxWholeFileReadBytes requires readFileBytes`);
  }

  const captured = createObject(null) as {
    whole?: CapturedWholeFileReader;
    prefix?: LimitedByteReader;
    exact?: LimitedByteReader;
  };
  if (rawWhole !== undefined && ceiling !== undefined) {
    captured.whole = freezeObject({
      maximumBytes: ceiling,
      read: async (path: string) =>
        copyFixedUint8ArrayWithinLimit(
          await apply(rawWhole, value, [path]),
          ceiling,
          `${label} whole-file read`,
        ),
    });
  }
  if (rawPrefix !== undefined) {
    captured.prefix = async (path: string, byteLimit: number) => {
      const limit = positiveSafeInteger(byteLimit, `${label} prefix byte limit`);
      return copyFixedUint8ArrayWithinLimit(
        await apply(rawPrefix, value, [path, limit]),
        limit,
        `${label} prefix read`,
      );
    };
  }
  if (rawExact !== undefined) {
    captured.exact = async (path: string, byteLimit: number) => {
      const limit = positiveSafeInteger(byteLimit, `${label} exact byte limit`);
      return copyFixedUint8ArrayWithinLimit(
        await apply(rawExact, value, [path, limit]),
        limit,
        `${label} exact read`,
      );
    };
  }
  return freezeObject(captured);
}

export function captureSnapshotReadCapability(
  value: unknown,
  label = "Filesystem",
): CapturedSnapshotReader | undefined {
  requireCapabilityObject(value, label);
  const properties = captureDataProperties(value, ["readFileSnapshotWithinLimit"], label);
  const raw = optionalMethod<SnapshotByteReader>(
    properties.readFileSnapshotWithinLimit,
    label,
    "readFileSnapshotWithinLimit",
  );
  if (raw === undefined) return undefined;
  return freezeObject({
    read: async (path: string, containmentRoot: string, byteLimit: number) => {
      const limit = positiveSafeInteger(byteLimit, `${label} snapshot byte limit`);
      return copyFixedUint8ArrayWithinLimit(
        await apply(raw, value, [path, containmentRoot, limit]),
        limit,
        `${label} snapshot read`,
      );
    },
  });
}

export function captureExclusiveCreateCapability(
  value: unknown,
  label = "Filesystem",
): CapturedExclusiveCreator | undefined {
  requireCapabilityObject(value, label);
  const properties = captureDataProperties(value, ["createFileBytesExclusive"], label);
  const raw = optionalMethod<ByteWriter>(
    properties.createFileBytesExclusive,
    label,
    "createFileBytesExclusive",
  );
  if (raw === undefined) return undefined;
  return freezeObject({
    create: (path: string, content: Uint8Array) => {
      const length = uint8ArrayByteLength(content);
      if (length === undefined) throw new TypeError(`${label} create content must be Uint8Array`);
      const copy = copyFixedUint8ArrayWithinLimit(
        content,
        length === 0 ? 1 : length,
        `${label} create content`,
      );
      return apply(raw, value, [path, copy]) as Promise<void>;
    },
  });
}

/**
 * Capture static-read authority by purpose. A malformed ordinary byte reader
 * cannot invalidate an independently captured native snapshot reader.
 */
export function captureStaticReadCapabilities(
  value: unknown,
  label = "Filesystem",
): CapturedStaticReaders {
  requireCapabilityObject(value, label);
  const captured = createObject(null) as {
    snapshot?: CapturedSnapshotReader;
    virtual?: NonNullable<CapturedStaticReaders["virtual"]>;
  };
  const snapshot = captureSnapshotReadCapability(value, label);
  if (snapshot !== undefined) captured.snapshot = snapshot;

  let marker: PropertyDescriptor | undefined;
  try {
    marker = getOwnPropertyDescriptor(value, "symlinkSemantics");
  } catch (cause) {
    throw new TypeError(`${label} symlink semantics could not be inspected safely`, { cause });
  }
  if (!marker || !hasOwn(marker, "value") || marker.value !== "none") {
    return freezeObject(captured);
  }

  const generationProperties = captureDataProperties(value, ["getSourceSnapshotVersion"], label);
  const rawGeneration = optionalMethod<GenerationReader>(
    generationProperties.getSourceSnapshotVersion,
    label,
    "getSourceSnapshotVersion",
  );
  if (rawGeneration === undefined) return freezeObject(captured);

  let readers: CapturedByteReaders;
  try {
    readers = captureByteReadCapabilities(value, label);
  } catch {
    // Snapshot authority remains available even when legacy reader fields are
    // malformed. Virtual authority is omitted as one indivisible capability.
    return freezeObject(captured);
  }
  if (readers.exact === undefined && readers.whole === undefined) {
    return freezeObject(captured);
  }

  const virtual = createObject(null) as {
    generation(): Promise<number>;
    exact?: LimitedByteReader;
    whole?: CapturedWholeFileReader;
  };
  virtual.generation = async () =>
    positiveSafeInteger(
      await apply(rawGeneration, value, []),
      `${label} source snapshot generation`,
    );
  if (readers.exact !== undefined) virtual.exact = readers.exact;
  if (readers.whole !== undefined) virtual.whole = readers.whole;
  captured.virtual = freezeObject(virtual);
  return freezeObject(captured);
}
