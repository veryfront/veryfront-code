import { closeSync, openSync, readSync } from "node:fs";

const MAX_CREDENTIAL_BYTES = 65_536;
const NativeUint8Array = Uint8Array;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const decodeUtf8 = TextDecoder.prototype.decode;
const subarrayBytes = Uint8Array.prototype.subarray;
const stringTrim = String.prototype.trim;
const apply = Reflect.apply;

/** Read one renewable runtime credential without retaining it across calls. */
export function readVeryfrontApiTokenFile(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  if (!path) throw new TypeError("Veryfront API token file path is empty");
  const descriptor = openSync(path, "r");
  try {
    const bytes = new NativeUint8Array(MAX_CREDENTIAL_BYTES + 1);
    const length = readSync(descriptor, bytes, 0, bytes.length, 0);
    if (length > MAX_CREDENTIAL_BYTES) {
      throw new RangeError("Veryfront API token file exceeds the credential size limit");
    }
    const slice = apply(subarrayBytes, bytes, [0, length]) as Uint8Array;
    const token = apply(stringTrim, apply(decodeUtf8, utf8Decoder, [slice]), []) as string;
    if (!token) throw new TypeError("Veryfront API token file is empty");
    return token;
  } finally {
    closeSync(descriptor);
  }
}
