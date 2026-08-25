import {
  copyFixedUint8ArrayWithinLimit,
} from "#veryfront/platform/adapters/bounded-text-reader.ts";
import {
  isNativeErrorWithoutHooks,
  readNativeErrorNameWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";
import { MAX_SERVABLE_MODULE_SOURCE_BYTES } from "./module-limits.ts";

export type ExactModuleSourceReader = (
  path: string,
  byteLimit: number,
) => Promise<Uint8Array>;

const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const textDecoderDecode = TextDecoder.prototype.decode;

function isNativeRangeError(value: unknown): boolean {
  return isNativeErrorWithoutHooks(value) &&
    readNativeErrorNameWithoutHooks(value) === "RangeError";
}

/**
 * Read one module source through an exact byte-boundary and decode it as strict
 * UTF-8. Callers must provide the secured exact reader;
 * an unbounded compatibility read is never accepted.
 */
export async function readBoundedModuleSource(
  readWithinLimit: ExactModuleSourceReader | undefined,
  path: string,
  maxBytes = MAX_SERVABLE_MODULE_SOURCE_BYTES,
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("Module source maxBytes must be a positive safe integer");
  }
  if (typeof readWithinLimit !== "function") {
    throw new TypeError("Module source requires an exact bounded byte reader");
  }

  let bytes: Uint8Array;
  try {
    bytes = copyFixedUint8ArrayWithinLimit(
      await readWithinLimit(path, maxBytes),
      maxBytes,
      "Module source",
    );
  } catch (cause) {
    if (isNativeRangeError(cause)) {
      throw new RangeError(`Module source exceeds ${maxBytes} bytes`, { cause });
    }
    throw cause;
  }

  try {
    return Reflect.apply(textDecoderDecode, strictUtf8Decoder, [bytes]) as string;
  } catch (cause) {
    throw new TypeError("Module source must contain valid UTF-8", { cause });
  }
}
