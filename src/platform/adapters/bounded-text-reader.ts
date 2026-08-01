import {
  isNativeErrorWithoutHooks,
  readNativeErrorNameWithoutHooks,
} from "../compat/error-introspection.ts";
import { captureFileSystemCapabilities } from "./file-system-capabilities.ts";

const apply = Reflect.apply;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
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
  "ArrayBuffer byteLength",
);
const arrayBufferResizableGetter = getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "resizable",
)?.get;
const setBytes = NativeUint8Array.prototype.set;
const textDecoderDecode = TextDecoder.prototype.decode;
const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

export interface CapturedBoundedTextReader {
  readUtf8(
    path: string,
    maximumBytes: number,
    label: string,
  ): Promise<{ content: string; byteLength: number }>;
}

function requireIntrinsicGetter(
  target: object,
  property: PropertyKey,
  name: string,
): (this: object) => unknown {
  const getter = getOwnPropertyDescriptor(target, property)?.get;
  if (typeof getter !== "function") {
    throw new TypeError(`Required ${name} intrinsic is unavailable`);
  }
  return getter;
}

function getUint8ArrayByteLength(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    if (apply(typedArrayNameGetter, value, []) !== "Uint8Array") {
      return undefined;
    }
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
  if (byteLength > maximumBytes) {
    throw new TypeError(`${label} exceeds ${maximumBytes} bytes`);
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

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return apply(textDecoderDecode, strictUtf8Decoder, [bytes]) as string;
  } catch (cause) {
    throw new TypeError(`${label} must contain valid UTF-8`, { cause });
  }
}

/**
 * Capture a filesystem's genuine exact bounded-read capability without invoking
 * accessors or Proxy traps. The returned reader never falls back to text or
 * unbounded binary reads. A whole-file reader is usable only when its fixed
 * upstream ceiling is no larger than the caller's requested maximum.
 */
export function captureBoundedTextReader(
  value: unknown,
  label = "Bounded text reader",
): CapturedBoundedTextReader {
  const capabilities = captureFileSystemCapabilities(value, label);
  const exactReader = capabilities.readFileBytesWithinLimit;
  const wholeFileReader = capabilities.wholeFileReader;

  return Object.freeze({
    async readUtf8(
      path: string,
      maximumBytes: number,
      contentLabel: string,
    ): Promise<{ content: string; byteLength: number }> {
      if (typeof path !== "string" || path.length === 0) {
        throw new TypeError(`${contentLabel} path must be a non-empty string`);
      }
      if (!numberIsSafeInteger(maximumBytes) || maximumBytes <= 0) {
        throw new RangeError(`${contentLabel} maximum must be a positive safe integer`);
      }

      let bytes: unknown;
      if (exactReader !== undefined) {
        try {
          bytes = await exactReader(path, maximumBytes);
        } catch (cause) {
          // The exact-read contract reserves RangeError for source overflow.
          // Normalize it to the content-admission error used by CSS callers
          // while preserving operational filesystem failures unchanged.
          if (
            isNativeErrorWithoutHooks(cause) &&
            readNativeErrorNameWithoutHooks(cause) === "RangeError"
          ) {
            throw new TypeError(`${contentLabel} exceeds ${maximumBytes} bytes`, {
              cause,
            });
          }
          throw cause;
        }
      } else if (
        wholeFileReader !== undefined &&
        wholeFileReader.maximumBytes <= maximumBytes
      ) {
        bytes = await wholeFileReader.read(path);
      } else {
        throw new TypeError(
          `${contentLabel} requires a genuine exact bounded byte reader or a fixed whole-file ceiling no larger than ${maximumBytes} bytes`,
        );
      }

      const admittedMaximum = exactReader === undefined
        ? wholeFileReader!.maximumBytes
        : maximumBytes;
      const admittedBytes = copyFixedUint8ArrayWithinLimit(
        bytes,
        admittedMaximum,
        contentLabel,
      );
      const byteLength = getFixedUint8ArrayByteLength(admittedBytes, contentLabel);

      return {
        content: decodeUtf8(admittedBytes, contentLabel),
        byteLength,
      };
    },
  });
}
