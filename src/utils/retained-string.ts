import { utf8ByteLength } from "./utf8-byte-length.ts";

const COPY_CHUNK_CODE_UNITS = 8 * 1024;
const STORAGE_NODE_OVERHEAD_BYTES = 64;
const apply = Reflect.apply;
const ArrayConstructor = Array;
const NativeRangeError = RangeError;
const NativeTypeError = TypeError;
const Uint16ArrayConstructor = Uint16Array;
const arrayJoin = Array.prototype.join;
const mathCeil = Math.ceil;
const mathMax = Math.max;
const mathMin = Math.min;
const numberIsSafeInteger = Number.isSafeInteger;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringFromCharCode = String.fromCharCode;

/** Conservatively estimate a detached string's retained UTF-8/UTF-16 storage. */
export function estimateRetainedStringBytes(value: string): number {
  if (typeof value !== "string") {
    throw new NativeTypeError("Retained cache value must be a string");
  }
  const utf16Bytes = value.length * 2;
  const storageNodes = mathMax(1, mathCeil(value.length / COPY_CHUNK_CODE_UNITS));
  const overheadBytes = storageNodes * STORAGE_NODE_OVERHEAD_BYTES;
  if (!numberIsSafeInteger(utf16Bytes) || !numberIsSafeInteger(overheadBytes)) {
    throw new NativeRangeError("Retained cache string exceeds the safe size range");
  }
  return mathMax(utf16Bytes, utf8ByteLength(value)) + overheadBytes;
}

/**
 * Copy a string through its UTF-16 code units so a cached slice or rope cannot
 * retain an unaccounted parent allocation.
 */
export function detachRetainedString(value: string): string {
  if (typeof value !== "string") {
    throw new NativeTypeError("Retained cache value must be a string");
  }
  if (value.length === 0) return "";

  const chunks = new ArrayConstructor<string>(mathCeil(value.length / COPY_CHUNK_CODE_UNITS));
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const start = chunkIndex * COPY_CHUNK_CODE_UNITS;
    const end = mathMin(start + COPY_CHUNK_CODE_UNITS, value.length);
    const codeUnits = new Uint16ArrayConstructor(end - start);
    for (let index = start; index < end; index++) {
      codeUnits[index - start] = apply(stringCharCodeAt, value, [index]) as number;
    }
    chunks[chunkIndex] = apply(stringFromCharCode, undefined, codeUnits) as string;
  }
  return chunks.length === 1 ? chunks[0]! : apply(arrayJoin, chunks, [""]) as string;
}
