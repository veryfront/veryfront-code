const apply = Reflect.apply;
const NativeUint8Array = Uint8Array;
const NativeArrayBuffer = ArrayBuffer;
const NativeDataView = DataView;
const hasInstance = Function.prototype[Symbol.hasInstance];
const isView = ArrayBuffer.isView;
const descriptor = Object.getOwnPropertyDescriptor;
const typedArrayPrototype = Object.getPrototypeOf(NativeUint8Array.prototype);
const typedBuffer = descriptor(typedArrayPrototype, "buffer")!.get!;
const typedOffset = descriptor(typedArrayPrototype, "byteOffset")!.get!;
const typedLength = descriptor(typedArrayPrototype, "byteLength")!.get!;
const viewBuffer = descriptor(NativeDataView.prototype, "buffer")!.get!;
const viewOffset = descriptor(NativeDataView.prototype, "byteOffset")!.get!;
const viewLength = descriptor(NativeDataView.prototype, "byteLength")!.get!;
const set = NativeUint8Array.prototype.set;
const minimum = Math.min;
const maximum = Math.max;
const truncate = Math.trunc;
const numberIsNaN = Number.isNaN;

export const PrivateUint8Array = NativeUint8Array;

export function isPrivateUint8Array(value: unknown): value is Uint8Array {
  return apply(hasInstance, NativeUint8Array, [value]) as boolean;
}

/** Normalize native binary views without calling project-controlled constructors or accessors. */
export function toPrivateUint8Array(value: unknown): Uint8Array | undefined {
  if (isPrivateUint8Array(value)) return value;
  if (isView(value)) {
    let dataView = false;
    let buffer: ArrayBufferLike;
    try {
      buffer = apply(viewBuffer, value, []) as ArrayBufferLike;
      dataView = true;
    } catch {
      buffer = apply(typedBuffer, value, []) as ArrayBufferLike;
    }
    const offset = apply(dataView ? viewOffset : typedOffset, value, []) as number;
    const length = apply(dataView ? viewLength : typedLength, value, []) as number;
    return new NativeUint8Array(buffer, offset, length);
  }
  if (apply(hasInstance, NativeArrayBuffer, [value])) {
    return new NativeUint8Array(value as ArrayBuffer);
  }
  return undefined;
}

export function privateByteLength(value: Uint8Array): number {
  return apply(typedLength, value, []) as number;
}

export function privateByteSubarray(value: Uint8Array, start: number, end?: number): Uint8Array {
  const length = privateByteLength(value);
  const index = (value: number): number => {
    const integer = numberIsNaN(value) ? 0 : truncate(value);
    return integer < 0 ? maximum(length + integer, 0) : minimum(integer, length);
  };
  const first = index(start);
  const last = end === undefined ? length : index(end);
  const buffer = apply(typedBuffer, value, []) as ArrayBufferLike;
  const offset = apply(typedOffset, value, []) as number;
  return new NativeUint8Array(buffer, offset + first, maximum(last - first, 0));
}

export function setPrivateBytes(target: Uint8Array, source: Uint8Array, offset = 0): void {
  apply(set, target, [source, offset]);
}
