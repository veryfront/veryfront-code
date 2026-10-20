import { getCapturedDenoRuntime, isBun, isDeno, isNode } from "../compat/runtime.ts";

type FileSystem = Pick<typeof import("node:fs"), "openSync" | "readSync" | "closeSync">;
declare const require: ((specifier: string) => unknown) | undefined;

// Resolve host builtins only on filesystem-capable runtimes. Edge module graphs
// must remain linkable when no credential file is selected.
function loadFileSystem(): FileSystem | undefined {
  if (!isBun && !isDeno && !isNode) return undefined;
  const host = (globalThis as typeof globalThis & {
    process?: { getBuiltinModule?: (specifier: string) => unknown };
  }).process;
  const descriptor = host && Object.getOwnPropertyDescriptor(host, "getBuiltinModule");
  const loader = descriptor?.value ??
    (typeof descriptor?.get === "function" ? Reflect.apply(descriptor.get, host, []) : undefined);
  if (typeof loader === "function") {
    return Reflect.apply(loader, host, ["node:fs"]) as FileSystem;
  }
  if (isBun && typeof require === "function") return require("node:fs") as FileSystem;
  return undefined;
}
const fileSystem = loadFileSystem();
const openSync = fileSystem?.openSync;
const readSync = fileSystem?.readSync;
const closeSync = fileSystem?.closeSync;
const deno = getCapturedDenoRuntime();
const denoOpenSync = deno?.openSync;
const denoReadSync = deno?.FsFile.prototype.readSync;
const denoClose = deno?.FsFile.prototype.close;

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
  if (deno && denoOpenSync && denoReadSync && denoClose) {
    const file = apply(denoOpenSync, deno, [path, { read: true }]) as Deno.FsFile;
    try {
      return decodeCredential((bytes) => apply(denoReadSync, file, [bytes]) as number | null);
    } finally {
      apply(denoClose, file, []);
    }
  }
  if (!openSync || !readSync || !closeSync) {
    throw new TypeError("Veryfront API token files are unavailable on this host");
  }
  const descriptor = openSync(path, "r");
  try {
    return decodeCredential((bytes) => readSync(descriptor, bytes, 0, bytes.length, null));
  } finally {
    closeSync(descriptor);
  }
}

function decodeCredential(read: (bytes: Uint8Array) => number | null): string {
  const bytes = new NativeUint8Array(MAX_CREDENTIAL_BYTES + 1);
  let length = 0;
  while (length < bytes.length) {
    const target = apply(subarrayBytes, bytes, [length]) as Uint8Array;
    const count = read(target);
    if (!count) break;
    length += count;
  }
  if (length > MAX_CREDENTIAL_BYTES) {
    throw new RangeError("Veryfront API token file exceeds the credential size limit");
  }
  const slice = apply(subarrayBytes, bytes, [0, length]) as Uint8Array;
  const token = apply(stringTrim, apply(decodeUtf8, utf8Decoder, [slice]), []) as string;
  if (!token) throw new TypeError("Veryfront API token file is empty");
  return token;
}
