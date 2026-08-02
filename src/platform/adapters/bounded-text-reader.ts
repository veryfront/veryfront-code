import {
  isNativeErrorWithoutHooks,
  readNativeErrorNameWithoutHooks,
} from "../compat/error-introspection.ts";
import {
  captureFileSystemCapabilities,
  captureSnapshotReadCapability,
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
const freezeObject = Object.freeze;
const textDecoderDecode = TextDecoder.prototype.decode;
const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

export interface CapturedBoundedTextReader {
  readUtf8(
    path: string,
    maximumBytes: number,
    label: string,
  ): Promise<{ content: string; byteLength: number }>;
}

export interface CapturedSnapshotTextReader {
  readUtf8(
    path: string,
    containmentRoot: string,
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

function validateTextRead(
  path: string,
  maximumBytes: number,
  label: string,
): void {
  if (typeof path !== "string" || path.length === 0) {
    throw new TypeError(`${label} path must be a non-empty string`);
  }
  if (!numberIsSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new RangeError(`${label} maximum must be a positive safe integer`);
  }
}

function isNativeRangeError(value: unknown): boolean {
  return isNativeErrorWithoutHooks(value) &&
    readNativeErrorNameWithoutHooks(value) === "RangeError";
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

  return freezeObject({
    async readUtf8(
      path: string,
      maximumBytes: number,
      contentLabel: string,
    ): Promise<{ content: string; byteLength: number }> {
      validateTextRead(path, maximumBytes, contentLabel);

      let bytes: unknown;
      if (exactReader !== undefined) {
        try {
          bytes = await exactReader(path, maximumBytes);
        } catch (cause) {
          // The exact-read contract reserves RangeError for source overflow.
          // Normalize it to the content-admission error used by CSS callers
          // while preserving operational filesystem failures unchanged.
          if (isNativeRangeError(cause)) {
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
      let admittedBytes: Uint8Array;
      try {
        admittedBytes = copyFixedUint8ArrayWithinLimit(
          bytes,
          admittedMaximum,
          contentLabel,
        );
      } catch (cause) {
        // A dishonest reader result overflows during admission rather than in
        // the reader itself; both overflows reach CSS callers as the same
        // content-admission error.
        if (isNativeRangeError(cause)) {
          throw new TypeError(`${contentLabel} exceeds ${maximumBytes} bytes`, { cause });
        }
        throw cause;
      }
      const byteLength = getFixedUint8ArrayByteLength(admittedBytes, contentLabel);

      return {
        content: decodeUtf8(admittedBytes, contentLabel),
        byteLength,
      };
    },
  });
}

/**
 * Capture and require a filesystem's root-bound stable snapshot capability.
 * The returned reader keeps the original method authority, admits a fixed
 * byte copy, and decodes strict UTF-8 without consulting mutable globals.
 */
export function captureSnapshotTextReader(
  value: unknown,
  label = "Snapshot text reader",
): CapturedSnapshotTextReader {
  const snapshotReader = captureSnapshotReadCapability(value, label);
  if (snapshotReader === undefined) {
    throw new TypeError(
      `${label} requires a genuine root-bound stable snapshot byte reader`,
    );
  }

  return freezeObject({
    async readUtf8(
      path: string,
      containmentRoot: string,
      maximumBytes: number,
      contentLabel: string,
    ): Promise<{ content: string; byteLength: number }> {
      validateTextRead(path, maximumBytes, contentLabel);
      if (typeof containmentRoot !== "string" || containmentRoot.length === 0) {
        throw new TypeError(`${contentLabel} containment root must be a non-empty string`);
      }

      let bytes: Uint8Array;
      try {
        bytes = await snapshotReader.read(path, containmentRoot, maximumBytes);
      } catch (cause) {
        if (isNativeRangeError(cause)) {
          throw new TypeError(`${contentLabel} exceeds ${maximumBytes} bytes`, {
            cause,
          });
        }
        throw cause;
      }

      const byteLength = getFixedUint8ArrayByteLength(bytes, contentLabel);
      return {
        content: decodeUtf8(bytes, contentLabel),
        byteLength,
      };
    },
  });
}
