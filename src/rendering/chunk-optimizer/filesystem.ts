import type { ChunkOptimizerFileSystem } from "./contracts.ts";

type UnknownMethod = (this: unknown, ...args: unknown[]) => unknown;

function findDataMethod(
  receiver: unknown,
  key: keyof ChunkOptimizerFileSystem,
): UnknownMethod {
  if (
    receiver === null ||
    (typeof receiver !== "object" && typeof receiver !== "function")
  ) {
    throw new TypeError("Chunk analysis filesystem must be an object");
  }

  const visited = new Set<object>();
  let candidate: object | null = receiver;
  while (candidate !== null) {
    if (visited.has(candidate) || visited.size >= 32) {
      throw new TypeError("Chunk analysis filesystem has an invalid prototype chain");
    }
    visited.add(candidate);

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(candidate, key);
    } catch {
      throw new TypeError(`Chunk analysis filesystem ${key} must be a data method`);
    }
    if (descriptor !== undefined) {
      if (
        !Object.hasOwn(descriptor, "value") ||
        typeof descriptor.value !== "function"
      ) {
        throw new TypeError(`Chunk analysis filesystem ${key} must be a data method`);
      }
      return descriptor.value as UnknownMethod;
    }

    try {
      candidate = Object.getPrototypeOf(candidate);
    } catch {
      throw new TypeError("Chunk analysis filesystem has an invalid prototype chain");
    }
  }

  throw new TypeError(`Chunk analysis filesystem is missing ${key}`);
}

/**
 * Snapshot callable filesystem capabilities once so later traversal cannot be
 * redirected by accessors or property mutation.
 */
export function snapshotChunkOptimizerFileSystem(
  receiver: unknown,
): ChunkOptimizerFileSystem {
  const readDir = findDataMethod(receiver, "readDir");
  const readTextFile = findDataMethod(receiver, "readTextFile");

  return Object.freeze({
    readDir(path: string): AsyncIterable<unknown> {
      return Reflect.apply(readDir, receiver, [path]) as AsyncIterable<unknown>;
    },
    async readTextFile(path: string): Promise<string> {
      return await Reflect.apply(readTextFile, receiver, [path]) as string;
    },
  });
}
