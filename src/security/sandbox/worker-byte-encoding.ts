// Worker byte encoders run at a tenant boundary after project modules may have
// changed globals. Capture the stable intrinsics once, before project code can
// execute, and avoid proposal methods that are unavailable on supported Node.
// Nothing here may reach a project-controlled hook: no species-aware typed
// array method, no dynamic `length` read, no dynamic method lookup.
const HEX_ALPHABET = "0123456789abcdef";
const BASE64_CHUNK_BYTES = 24 * 1024;
const BASE64_BATCH_BYTES = 8;
const BinaryStringToBase64 = globalThis.btoa;
const IntrinsicUint8Array = Uint8Array;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ReflectApply = Reflect.apply;
const StringFromCharCode = String.fromCharCode;
const TypedArrayPrototype = ObjectGetPrototypeOf(IntrinsicUint8Array.prototype);
const TypedArrayLengthGetter = ObjectGetOwnPropertyDescriptor(
  TypedArrayPrototype,
  "length",
)!.get!;

function byteLength(bytes: Uint8Array): number {
  return ReflectApply(TypedArrayLengthGetter, bytes, []) as number;
}

export function encodeSandboxBytesAsHex(bytes: Uint8Array): string {
  let encoded = "";
  const length = byteLength(bytes);
  for (let index = 0; index < length; index++) {
    const byte = bytes[index]!;
    encoded += HEX_ALPHABET[byte >>> 4]! + HEX_ALPHABET[byte & 0x0f]!;
  }
  return encoded;
}

export function encodeSandboxBytesAsBase64(bytes: Uint8Array): string {
  let encoded = "";
  const length = byteLength(bytes);
  for (let offset = 0; offset < length; offset += BASE64_CHUNK_BYTES) {
    const proposedEnd = offset + BASE64_CHUNK_BYTES;
    const end = proposedEnd < length ? proposedEnd : length;
    // Integer-indexed reads and fixed-arity calls only. A chunk view would go
    // through species construction, which a project module can hook.
    let binary = "";
    let index = offset;
    const batchEnd = end - BASE64_BATCH_BYTES;
    for (; index <= batchEnd; index += BASE64_BATCH_BYTES) {
      binary += StringFromCharCode(
        bytes[index]!,
        bytes[index + 1]!,
        bytes[index + 2]!,
        bytes[index + 3]!,
        bytes[index + 4]!,
        bytes[index + 5]!,
        bytes[index + 6]!,
        bytes[index + 7]!,
      );
    }
    for (; index < end; index++) {
      binary += StringFromCharCode(bytes[index]!);
    }
    encoded += BinaryStringToBase64(binary);
  }
  return encoded;
}
