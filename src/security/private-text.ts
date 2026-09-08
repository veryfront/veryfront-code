const apply = Reflect.apply;
const NativeTextEncoder = TextEncoder;
const NativeTextDecoder = TextDecoder;
const encode = NativeTextEncoder.prototype.encode;
const decode = NativeTextDecoder.prototype.decode;
const setPrototypeOf = Object.setPrototypeOf;
const freeze = Object.freeze;
const encoder = new NativeTextEncoder();

export const PrivateTextEncoder = NativeTextEncoder;

export function encodePrivateText(input?: string, target: TextEncoder = encoder): Uint8Array {
  return apply(encode, target, [input]) as Uint8Array;
}

export function createPrivateTextDecoder(
  label?: string,
  options?: TextDecoderOptions,
): Pick<TextDecoder, "decode"> {
  const decoder = new NativeTextDecoder(label, options);
  const facade = {
    decode: (input?: AllowSharedBufferSource, options?: TextDecodeOptions): string =>
      apply(decode, decoder, [input, options]) as string,
  };
  setPrototypeOf(facade, null);
  return freeze(facade);
}
