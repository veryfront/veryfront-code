import { isBun, isDeno, isNode } from "./runtime.ts";

type NodeFileOperations = Pick<
  typeof import("node:fs"),
  "open" | "write" | "close" | "unlink" | "rename"
>;
type HostRequire = (specifier: string) => unknown;
declare const require: HostRequire | undefined;

const apply = Reflect.apply;
const createObject = Object.create;
const defineProperty = Object.defineProperty;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const NativePromise = Promise;
const deno = isDeno ? Deno : undefined;
const denoOpen = deno?.open;
const denoRemove = deno?.remove;
const denoRename = deno?.rename;
const denoWrite = deno?.FsFile.prototype.write;
const denoClose = deno?.FsFile.prototype.close;

function ownFunction(
  value: unknown,
  key: PropertyKey,
): ((...args: unknown[]) => unknown) | undefined {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return undefined;
  }
  const descriptor = getOwnPropertyDescriptor(value, key);
  return descriptor && apply(hasOwnProperty, descriptor, ["value"]) &&
      typeof descriptor.value === "function"
    ? descriptor.value
    : undefined;
}

function captureNodeFileOperations(): NodeFileOperations | undefined {
  if (!isNode && !isBun) return undefined;
  const process = (globalThis as typeof globalThis & { process?: object }).process;
  const getBuiltinModule = process && ownFunction(process, "getBuiltinModule");
  const module = getBuiltinModule
    ? apply(getBuiltinModule, process, ["node:fs"])
    : isBun && typeof require === "function"
    ? apply(require, undefined, ["node:fs"])
    : undefined;
  if (module === null || typeof module !== "object") {
    throw new Error("Native filesystem stream operations are unavailable");
  }
  const operations = createObject(null) as NodeFileOperations;
  for (const key of ["open", "write", "close", "unlink", "rename"] as const) {
    const method = ownFunction(module, key);
    if (!method) throw new Error(`Native filesystem ${key} operation is unavailable`);
    const descriptor = createObject(null) as PropertyDescriptor;
    descriptor.value = method;
    defineProperty(operations, key, descriptor);
  }
  return freeze(operations);
}

const node = captureNodeFileOperations();

function protectPromise<T>(promise: Promise<T>): Promise<T> {
  const descriptor = createObject(null) as PropertyDescriptor;
  descriptor.value = NativePromise;
  void defineProperty(promise, "constructor", descriptor);
  return promise;
}

export interface NativeStreamFile {
  write(chunk: Uint8Array): Promise<number>;
  close(): void | Promise<void>;
}

/** Capture filesystem authority during host bootstrap, before project hooks run. */
export async function openNativeStreamFile(path: string): Promise<NativeStreamFile> {
  const file = createObject(null) as NativeStreamFile;
  if (deno && denoOpen && denoWrite && denoClose) {
    const options = createObject(null) as Deno.OpenOptions;
    options.write = true;
    options.createNew = true;
    options.mode = 0o600;
    const handle = await protectPromise(
      apply(denoOpen, deno, [path, options]) as Promise<Deno.FsFile>,
    );
    file.write = (chunk) => apply(denoWrite, handle, [chunk]) as Promise<number>;
    let closed = false;
    file.close = () => {
      if (closed) return;
      closed = true;
      apply(denoClose, handle, []);
    };
    return freeze(file);
  }
  if (!node) throw new Error("Native filesystem stream operations are unavailable");
  const operations = node;
  const fd = await protectPromise(
    new NativePromise<number>((resolve, reject) => {
      operations.open(path, "wx", 0o600, (error, descriptor) => {
        if (error) reject(error);
        else resolve(descriptor);
      });
    }),
  );
  file.write = (chunk) =>
    new NativePromise<number>((resolve, reject) => {
      operations.write(fd, chunk, 0, chunk.byteLength, null, (error, written) => {
        if (error) reject(error);
        else resolve(written);
      });
    });
  let closing: Promise<void> | undefined;
  file.close = () =>
    closing ??= new NativePromise<void>((resolve, reject) => {
      operations.close(fd, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  return freeze(file);
}

/** Remove an incomplete exclusive stream file through captured host authority. */
export function removeNativeStreamFile(path: string): Promise<void> {
  if (deno && denoRemove) return apply(denoRemove, deno, [path]) as Promise<void>;
  if (!node) throw new Error("Native filesystem stream operations are unavailable");
  return new NativePromise<void>((resolve, reject) => {
    node.unlink(path, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/** Promote a completed private file through authority captured at host bootstrap. */
export function renameNativeStreamFile(from: string, to: string): Promise<void> {
  if (deno && denoRename) return apply(denoRename, deno, [from, to]) as Promise<void>;
  if (!node) throw new Error("Native filesystem stream operations are unavailable");
  return new NativePromise<void>((resolve, reject) => {
    node.rename(from, to, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
