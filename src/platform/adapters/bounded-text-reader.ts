import { isProxyWithoutHooks } from "../compat/error-introspection.ts";

const apply = Reflect.apply;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const numberIsSafeInteger = Number.isSafeInteger;
const typedArrayPrototype = getPrototypeOf(Uint8Array.prototype);
const typedArrayByteLengthGetter = requireIntrinsicGetter(
  typedArrayPrototype,
  "byteLength",
  "Uint8Array byteLength",
);
const typedArrayNameGetter = requireIntrinsicGetter(
  typedArrayPrototype,
  Symbol.toStringTag,
  "Uint8Array name",
);
const textDecoderDecode = TextDecoder.prototype.decode;
const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

type ReaderProperty =
  | "maxWholeFileReadBytes"
  | "readFileBytes"
  | "readFileBytesWithinLimit";

type ByteReader = (path: string) => Promise<Uint8Array>;
type ExactByteReader = (
  path: string,
  byteLimit: number,
) => Promise<Uint8Array>;

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

function readDataProperty(
  value: object,
  property: ReaderProperty,
  label: string,
): unknown {
  let owner: object | null = value;
  const seen = new Set<object>();
  for (let depth = 0; owner !== null && depth < 64; depth++) {
    if (isProxyWithoutHooks(owner)) {
      throw new TypeError(`${label} must not be a Proxy`);
    }
    if (seen.has(owner)) {
      throw new TypeError(`${label} has an invalid prototype chain`);
    }
    seen.add(owner);

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = getOwnPropertyDescriptor(owner, property);
    } catch (cause) {
      throw new TypeError(`${label} capabilities could not be inspected safely`, {
        cause,
      });
    }
    if (descriptor !== undefined) {
      if (!("value" in descriptor)) {
        throw new TypeError(`${label} ${property} must be a data property`);
      }
      return descriptor.value;
    }

    try {
      owner = getPrototypeOf(owner);
    } catch (cause) {
      throw new TypeError(`${label} capabilities could not be inspected safely`, {
        cause,
      });
    }
  }
  if (owner !== null) {
    throw new TypeError(`${label} prototype chain is too deep`);
  }
  return undefined;
}

function captureMethod<T extends (...args: never[]) => unknown>(
  value: object,
  property: ReaderProperty,
  label: string,
): T | undefined {
  const method = readDataProperty(value, property, label);
  if (method === undefined) return undefined;
  if (typeof method !== "function" || isProxyWithoutHooks(method)) {
    throw new TypeError(`${label} ${property} must be a non-Proxy function`);
  }
  return method as T;
}

function captureWholeReadCeiling(value: object, label: string): number | undefined {
  const ceiling = readDataProperty(value, "maxWholeFileReadBytes", label);
  if (ceiling === undefined) return undefined;
  if (!numberIsSafeInteger(ceiling) || (ceiling as number) <= 0) {
    throw new TypeError(`${label} maxWholeFileReadBytes must be a positive safe integer`);
  }
  return ceiling as number;
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
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    isProxyWithoutHooks(value)
  ) {
    throw new TypeError(`${label} must be a non-Proxy object`);
  }

  const exactReader = captureMethod<ExactByteReader>(
    value,
    "readFileBytesWithinLimit",
    label,
  );
  const wholeReader = captureMethod<ByteReader>(value, "readFileBytes", label);
  const wholeReadCeiling = captureWholeReadCeiling(value, label);

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
          bytes = await apply(exactReader, value, [path, maximumBytes]);
        } catch (cause) {
          // The exact-read contract reserves RangeError for source overflow.
          // Normalize it to the content-admission error used by CSS callers
          // while preserving operational filesystem failures unchanged.
          if (cause instanceof RangeError) {
            throw new TypeError(`${contentLabel} exceeds ${maximumBytes} bytes`, {
              cause,
            });
          }
          throw cause;
        }
      } else if (
        wholeReader !== undefined &&
        wholeReadCeiling !== undefined &&
        wholeReadCeiling <= maximumBytes
      ) {
        bytes = await apply(wholeReader, value, [path]);
      } else {
        throw new TypeError(
          `${contentLabel} requires a genuine exact bounded byte reader or a fixed whole-file ceiling no larger than ${maximumBytes} bytes`,
        );
      }

      const byteLength = getUint8ArrayByteLength(bytes);
      if (byteLength === undefined) {
        throw new TypeError(`${contentLabel} reader returned invalid bytes`);
      }
      if (byteLength > maximumBytes) {
        throw new TypeError(`${contentLabel} exceeds ${maximumBytes} bytes`);
      }

      return {
        content: decodeUtf8(bytes as Uint8Array, contentLabel),
        byteLength,
      };
    },
  });
}
