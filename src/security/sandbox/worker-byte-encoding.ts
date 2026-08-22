// Worker byte encoders run at a tenant boundary after project modules may have
// changed globals. Capture the stable intrinsics once, before project code can
// execute, and avoid proposal methods that are unavailable on supported Node.
const HEX_ALPHABET = "0123456789abcdef";
const BASE64_CHUNK_BYTES = 24 * 1024;
const BinaryStringToBase64 = globalThis.btoa;
const IntrinsicUint8Array = Uint8Array;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ReflectApply = Reflect.apply;
const StringFromCharCode = String.fromCharCode;
const Uint8ArrayPrototypeSubarray = IntrinsicUint8Array.prototype.subarray;
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
    const chunk = ReflectApply(
      Uint8ArrayPrototypeSubarray,
      bytes,
      [offset, end],
    ) as Uint8Array;
    const binary = ReflectApply(StringFromCharCode, undefined, chunk) as string;
    encoded += ReflectApply(BinaryStringToBase64, undefined, [binary]) as string;
  }
  return encoded;
}
