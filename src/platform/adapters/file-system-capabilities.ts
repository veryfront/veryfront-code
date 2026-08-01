import { isProxyWithoutHooks } from "../compat/error-introspection.ts";

const apply = Reflect.apply;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const numberIsSafeInteger = Number.isSafeInteger;
const universalObjectPrototype = Object.prototype;

const CAPABILITY_KEYS = [
  "readFileBytes",
  "readFileBytesBounded",
  "readFileBytesWithinLimit",
  "writeFileBytes",
  "maxWholeFileReadBytes",
] as const;

type CapabilityKey = (typeof CAPABILITY_KEYS)[number];
type ByteReader = (path: string) => Promise<Uint8Array>;
type BoundedByteReader = (path: string, byteLimit: number) => Promise<Uint8Array>;
type ByteWriter = (path: string, content: Uint8Array) => Promise<void>;

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

function invalidCapability(label: string, detail: string, cause?: unknown): TypeError {
  return cause === undefined
    ? new TypeError(`${label} ${detail}`)
    : new TypeError(`${label} ${detail}`, { cause });
}

function captureDataProperties(
  value: object,
  label: string,
): Readonly<Record<CapabilityKey, unknown>> {
  const unresolved = new Set<CapabilityKey>(CAPABILITY_KEYS);
  const properties = Object.create(null) as Record<CapabilityKey, unknown>;
  let owner: object | null = value;
  const seen = new Set<object>();

  for (let depth = 0; owner !== null && depth < 64; depth++) {
    // Object.prototype is universal ambient state, not filesystem authority.
    // Never let prototype pollution fabricate a capability that the adapter
    // did not explicitly provide on its own implementation chain.
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
    // A non-root terminal prototype is ambient realm state (normally that
    // realm's Object.prototype), never adapter authority. This identity-free
    // check also excludes foreign-realm universal prototypes while preserving
    // an explicitly supplied null-prototype adapter object.
    if (owner !== value && parent === null) {
      owner = null;
      break;
    }

    for (const key of unresolved) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = getOwnPropertyDescriptor(owner, key);
      } catch (cause) {
        throw invalidCapability(label, "capabilities could not be inspected safely", cause);
      }
      if (descriptor === undefined) continue;
      unresolved.delete(key);
      if (!("value" in descriptor)) {
        throw invalidCapability(
          label,
          key === "maxWholeFileReadBytes"
            ? `${key} must be a data property`
            : `${key} must be a data-property method`,
        );
      }
      properties[key] = descriptor.value;
    }

    if (unresolved.size === 0) break;
    owner = parent;
  }

  if (owner !== null && unresolved.size > 0) {
    throw invalidCapability(label, "capability prototype chain is too deep");
  }
  for (const key of unresolved) properties[key] = undefined;
  return Object.freeze(properties);
}

function requireOptionalMethod<T>(
  candidate: unknown,
  label: string,
  key: CapabilityKey,
): T | undefined {
  if (candidate === undefined) return undefined;
  if (typeof candidate !== "function" || isProxyWithoutHooks(candidate)) {
    throw invalidCapability(label, `${key} must be a non-Proxy function`);
  }
  return candidate as T;
}

/**
 * Capture binary filesystem capabilities without invoking accessors or Proxy
 * traps. Methods and the metadata that admits a fixed whole-file read are
 * retained as one immutable snapshot and never looked up on the source again.
 */
export function captureFileSystemCapabilities(
  value: unknown,
  label = "Filesystem",
): CapturedFileSystemCapabilities {
  if (
    typeof value !== "object" ||
    value === null ||
    isProxyWithoutHooks(value) ||
    Array.isArray(value)
  ) {
    throw invalidCapability(label, "must be a non-Proxy object");
  }

  const properties = captureDataProperties(value, label);
  const rawReadFileBytes = requireOptionalMethod<ByteReader>(
    properties.readFileBytes,
    label,
    "readFileBytes",
  );
  const rawBoundedReader = requireOptionalMethod<BoundedByteReader>(
    properties.readFileBytesBounded,
    label,
    "readFileBytesBounded",
  );
  const rawExactReader = requireOptionalMethod<BoundedByteReader>(
    properties.readFileBytesWithinLimit,
    label,
    "readFileBytesWithinLimit",
  );
  const rawWriter = requireOptionalMethod<ByteWriter>(
    properties.writeFileBytes,
    label,
    "writeFileBytes",
  );

  const ceiling = properties.maxWholeFileReadBytes;
  if (
    ceiling !== undefined &&
    (!numberIsSafeInteger(ceiling) || (ceiling as number) <= 0)
  ) {
    throw invalidCapability(
      label,
      "maxWholeFileReadBytes must be a positive safe integer",
    );
  }
  if (ceiling !== undefined && rawReadFileBytes === undefined) {
    throw invalidCapability(label, "maxWholeFileReadBytes requires readFileBytes");
  }

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
  const wholeFileReader = ceiling === undefined || readFileBytes === undefined
    ? undefined
    : Object.freeze(Object.assign(Object.create(null), {
      maximumBytes: ceiling as number,
      read: readFileBytes,
    })) as CapturedWholeFileReader;

  const captured = Object.create(null) as Record<string, unknown>;
  if (readFileBytes !== undefined) captured.readFileBytes = readFileBytes;
  if (readFileBytesBounded !== undefined) {
    captured.readFileBytesBounded = readFileBytesBounded;
  }
  if (readFileBytesWithinLimit !== undefined) {
    captured.readFileBytesWithinLimit = readFileBytesWithinLimit;
  }
  if (writeFileBytes !== undefined) captured.writeFileBytes = writeFileBytes;
  if (wholeFileReader !== undefined) captured.wholeFileReader = wholeFileReader;
  return Object.freeze(captured) as CapturedFileSystemCapabilities;
}
