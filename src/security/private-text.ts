const apply = Reflect.apply;
const startsWith = String.prototype.startsWith;
const slice = String.prototype.slice;

export function privateTextStartsWith(value: string, search: string): boolean {
  return apply(startsWith, value, [search]) as boolean;
}

export function privateTextSlice(value: string, start: number, end?: number): string {
  return apply(slice, value, [start, end]) as string;
}
const NativeTextEncoder = TextEncoder;
const NativeTextDecoder = TextDecoder;
const encode = NativeTextEncoder.prototype.encode;
const decode = NativeTextDecoder.prototype.decode;
const setPrototypeOf = Object.setPrototypeOf;
const freeze = Object.freeze;
const ownDescriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Object.hasOwn;
const encoder = new NativeTextEncoder();

function ownOption<T extends object, K extends keyof T>(
  value: T | undefined,
  key: K,
): T[K] | undefined {
  if (value === undefined) return undefined;
  const descriptor = ownDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!hasOwn(descriptor, "value")) {
    throw new TypeError("Private decoder options require data properties");
  }
  return descriptor.value as T[K];
}

export const PrivateTextEncoder = NativeTextEncoder;

export function encodePrivateText(input?: string, target: TextEncoder = encoder): Uint8Array {
  return apply(encode, target, [input]) as Uint8Array;
}

export function createPrivateTextDecoder(
  label?: string,
  options?: TextDecoderOptions,
): Pick<TextDecoder, "decode"> {
  const decoderOptions = {
    __proto__: null,
    fatal: ownOption(options, "fatal"),
    ignoreBOM: ownOption(options, "ignoreBOM"),
  };
  const decoder = new NativeTextDecoder(label, decoderOptions);
  const facade = {
    decode: (input?: AllowSharedBufferSource, options?: TextDecodeOptions): string =>
      apply(decode, decoder, [input, {
        __proto__: null,
        stream: ownOption(options, "stream"),
      }]) as string,
  };
  setPrototypeOf(facade, null);
  return freeze(facade);
}
