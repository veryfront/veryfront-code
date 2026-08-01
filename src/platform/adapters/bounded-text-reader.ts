import {
  isNativeErrorWithoutHooks,
  readNativeErrorNameWithoutHooks,
} from "../compat/error-introspection.ts";
import {
  captureFileSystemCapabilities,
  copyFixedUint8ArrayWithinLimit,
  getFixedUint8ArrayByteLength,
} from "./file-system-capabilities.ts";

export {
  copyFixedUint8ArrayWithinLimit,
  getFixedUint8ArrayBuffer,
  getFixedUint8ArrayByteLength,
} from "./file-system-capabilities.ts";

const apply = Reflect.apply;
const numberIsSafeInteger = Number.isSafeInteger;
const textDecoderDecode = TextDecoder.prototype.decode;
const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

export interface CapturedBoundedTextReader {
  readUtf8(
    path: string,
    maximumBytes: number,
    label: string,
  ): Promise<{ content: string; byteLength: number }>;
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
  const capabilities = captureFileSystemCapabilities(value, label, "bounded-text");
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
