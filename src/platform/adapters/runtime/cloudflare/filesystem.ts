import { CONFIG_INVALID } from "#veryfront/errors/error-registry/config.ts";
import { PLATFORM_ERROR } from "#veryfront/errors/error-registry/deploy.ts";
import {
  FILE_NOT_FOUND,
  INVALID_ARGUMENT,
  NOT_SUPPORTED,
} from "#veryfront/errors/error-registry/general.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import type {
  DirEntry,
  FileInfo,
  FileSystemAdapter,
  FileWatcher,
  WatchOptions,
} from "../../base.ts";
import { iterateCloudflareKVKeys } from "./kv.ts";
import type { KVListKey, KVMetadata, KVNamespace } from "./types.ts";

const FILE_SYSTEM_KEY_PREFIX = "__veryfront_fs_v1__/";
const FILE_SYSTEM_SCHEMA_VERSION = 1;
const DEFAULT_MAX_LISTED_KEYS = 500;
const MAX_KV_KEY_BYTES = 512;

type NodeKind = "file" | "directory";

interface FileSystemNode {
  kind: NodeKind;
  bytes: Uint8Array;
}

interface VirtualPath {
  path: string;
  key: string;
  isRoot: boolean;
}

export interface CloudflareFileSystemOptions {
  /** Maximum number of KV records one directory scan may inspect. */
  maxListedKeys?: number;
}

function invalidPath(message: string): never {
  throw INVALID_ARGUMENT.create({ message });
}

function resolveVirtualPath(input: string): VirtualPath {
  if (typeof input !== "string") invalidPath("Cloudflare filesystem path must be a string");
  if (input.includes("\0")) invalidPath("Cloudflare filesystem paths must not contain NUL bytes");

  const segments = input.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    invalidPath("Cloudflare filesystem paths must not contain traversal segments");
  }

  const path = segments.join("/");
  const key = `${FILE_SYSTEM_KEY_PREFIX}${path}`;
  if (new TextEncoder().encode(key).byteLength > MAX_KV_KEY_BYTES) {
    invalidPath("Cloudflare filesystem path exceeds the KV key length limit");
  }

  return { path, key, isRoot: path.length === 0 };
}

function parentPath(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "" : path.slice(0, separator);
}

function createNodeMetadata(kind: NodeKind): KVMetadata {
  return {
    veryfrontFileSystemVersion: FILE_SYSTEM_SCHEMA_VERSION,
    veryfrontFileSystemKind: kind,
  };
}

function parseNodeKind(metadata: KVMetadata | null | undefined): NodeKind {
  if (
    metadata?.veryfrontFileSystemVersion !== FILE_SYSTEM_SCHEMA_VERSION ||
    (metadata.veryfrontFileSystemKind !== "file" &&
      metadata.veryfrontFileSystemKind !== "directory")
  ) {
    throw CONFIG_INVALID.create({
      message: "Cloudflare filesystem storage contains an invalid node",
    });
  }
  return metadata.veryfrontFileSystemKind;
}

function toUint8Array(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer.slice(0));
}

async function runStorageOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof VeryfrontError) throw error;
    throw PLATFORM_ERROR.create({
      message: "Cloudflare filesystem storage operation failed",
    });
  }
}

export class CloudflareFileSystemAdapter implements FileSystemAdapter {
  private readonly maxListedKeys: number;

  constructor(
    private readonly kvNamespace?: KVNamespace,
    options: CloudflareFileSystemOptions = {},
  ) {
    const limit = options.maxListedKeys ?? DEFAULT_MAX_LISTED_KEYS;
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw INVALID_ARGUMENT.create({
        message: "Cloudflare filesystem directory scan limit must be a positive integer",
      });
    }
    this.maxListedKeys = limit;
  }

  private getKV(): KVNamespace {
    const kv = this.kvNamespace;
    if (!kv) {
      throw CONFIG_INVALID.create({
        message: "A KV namespace is required for Cloudflare filesystem operations",
      });
    }
    return kv;
  }

  private async loadNode(kv: KVNamespace, path: VirtualPath): Promise<FileSystemNode | null> {
    if (path.isRoot) return { kind: "directory", bytes: new Uint8Array() };

    const result = await runStorageOperation(() => kv.getWithMetadata(path.key, "arrayBuffer"));
    if (result.value === null) {
      if (result.metadata !== null) {
        throw CONFIG_INVALID.create({
          message: "Cloudflare filesystem storage contains metadata without a value",
        });
      }
      return null;
    }

    return {
      kind: parseNodeKind(result.metadata),
      bytes: toUint8Array(result.value),
    };
  }

  private async requireNode(kv: KVNamespace, path: VirtualPath): Promise<FileSystemNode> {
    const node = await this.loadNode(kv, path);
    if (!node) throw FILE_NOT_FOUND.create({ message: "Cloudflare filesystem path not found" });
    return node;
  }

  private async requireDirectory(kv: KVNamespace, path: VirtualPath): Promise<void> {
    const node = await this.requireNode(kv, path);
    if (node.kind !== "directory") {
      throw INVALID_ARGUMENT.create({ message: "Cloudflare filesystem path is not a directory" });
    }
  }

  private async putNode(
    kv: KVNamespace,
    path: VirtualPath,
    kind: NodeKind,
    value: string,
  ): Promise<void> {
    await runStorageOperation(() =>
      kv.put(path.key, value, {
        metadata: createNodeMetadata(kind),
      })
    );
  }

  private async listKeys(kv: KVNamespace, prefix: string): Promise<KVListKey[]> {
    return await runStorageOperation(async () => {
      const keys: KVListKey[] = [];
      for await (const key of iterateCloudflareKVKeys(kv, prefix)) {
        keys.push(key);
        if (keys.length > this.maxListedKeys) {
          throw INVALID_ARGUMENT.create({
            message: "Cloudflare filesystem directory scan exceeds the configured key limit",
          });
        }
      }
      return keys;
    });
  }

  async readFile(path: string): Promise<string> {
    const kv = this.getKV();
    const node = await this.requireNode(kv, resolveVirtualPath(path));
    if (node.kind !== "file") {
      throw INVALID_ARGUMENT.create({ message: "Cloudflare filesystem path is a directory" });
    }
    return new TextDecoder().decode(node.bytes);
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    const kv = this.getKV();
    const node = await this.requireNode(kv, resolveVirtualPath(path));
    if (node.kind !== "file") {
      throw INVALID_ARGUMENT.create({ message: "Cloudflare filesystem path is a directory" });
    }
    return node.bytes;
  }

  async writeFile(path: string, content: string): Promise<void> {
    const kv = this.getKV();
    const resolved = resolveVirtualPath(path);
    if (resolved.isRoot) invalidPath("Cloudflare filesystem root cannot be a file");

    await this.requireDirectory(kv, resolveVirtualPath(parentPath(resolved.path)));
    const current = await this.loadNode(kv, resolved);
    if (current?.kind === "directory") {
      throw INVALID_ARGUMENT.create({ message: "Cloudflare filesystem path is a directory" });
    }
    await this.putNode(kv, resolved, "file", content);
  }

  async exists(path: string): Promise<boolean> {
    const kv = this.getKV();
    return (await this.loadNode(kv, resolveVirtualPath(path))) !== null;
  }

  async *readDir(path: string): AsyncIterable<DirEntry> {
    const kv = this.getKV();
    const resolved = resolveVirtualPath(path);
    await this.requireDirectory(kv, resolved);

    const prefix = resolved.isRoot ? FILE_SYSTEM_KEY_PREFIX : `${resolved.key}/`;
    const entries = new Map<string, { kind?: NodeKind; hasDescendants: boolean }>();
    for (const key of await this.listKeys(kv, prefix)) {
      const relativePath = key.name.slice(prefix.length);
      const [name, ...descendants] = relativePath.split("/");
      if (!name) continue;

      const entry = entries.get(name) ?? { hasDescendants: false };
      if (descendants.length === 0) entry.kind = parseNodeKind(key.metadata);
      else entry.hasDescendants = true;
      entries.set(name, entry);
    }

    const sortedEntries = [...entries].sort(([left], [right]) => left.localeCompare(right));
    for (const [, entry] of sortedEntries) {
      if (!entry.kind || (entry.kind === "file" && entry.hasDescendants)) {
        throw CONFIG_INVALID.create({
          message: "Cloudflare filesystem storage contains conflicting nodes",
        });
      }
    }

    for (const [name, entry] of sortedEntries) {
      yield {
        name,
        isFile: entry.kind === "file",
        isDirectory: entry.kind === "directory",
        isSymlink: false,
      };
    }
  }

  async stat(path: string): Promise<FileInfo> {
    const kv = this.getKV();
    const node = await this.requireNode(kv, resolveVirtualPath(path));
    return {
      size: node.kind === "file" ? node.bytes.byteLength : 0,
      isFile: node.kind === "file",
      isDirectory: node.kind === "directory",
      isSymlink: false,
      mtime: null,
    };
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const kv = this.getKV();
    const resolved = resolveVirtualPath(path);
    if (resolved.isRoot) return;

    if (!options?.recursive) {
      const current = await this.loadNode(kv, resolved);
      if (current) {
        throw INVALID_ARGUMENT.create({
          message: current.kind === "file"
            ? "Cloudflare filesystem path is a file"
            : "Cloudflare filesystem directory already exists",
        });
      }

      const parent = resolveVirtualPath(parentPath(resolved.path));
      const parentNode = await this.loadNode(kv, parent);
      if (!parentNode || parentNode.kind !== "directory") {
        throw INVALID_ARGUMENT.create({ message: "Parent directory does not exist" });
      }
      await this.putNode(kv, resolved, "directory", "");
      return;
    }

    const segments = resolved.path.split("/");
    const paths = segments.map((_, index) =>
      resolveVirtualPath(segments.slice(0, index + 1).join("/"))
    );
    const missing: VirtualPath[] = [];
    for (const candidate of paths) {
      const node = await this.loadNode(kv, candidate);
      if (!node) missing.push(candidate);
      else if (node.kind !== "directory") {
        throw INVALID_ARGUMENT.create({ message: "Cloudflare filesystem path is a file" });
      }
    }
    for (const candidate of missing) await this.putNode(kv, candidate, "directory", "");
  }

  async remove(path: string, _options?: { recursive?: boolean }): Promise<void> {
    const kv = this.getKV();
    const resolved = resolveVirtualPath(path);
    if (resolved.isRoot) invalidPath("Cloudflare filesystem root cannot be removed");

    const node = await this.requireNode(kv, resolved);
    if (node.kind === "file") {
      await runStorageOperation(() => kv.delete(resolved.key));
      return;
    }

    // KV directory listings are eventually consistent. A list-then-delete
    // implementation can miss recent children or race with a concurrent
    // writer, leaving orphaned nodes. Directory deletion therefore requires a
    // strongly consistent coordinator that this adapter does not provide.
    throw NOT_SUPPORTED.create({
      message: "Cloudflare KV filesystem does not support directory removal",
      context: { platform: "cloudflare", operation: "removeDirectory" },
    });
  }

  makeTempDir(_prefix: string): Promise<string> {
    throw NOT_SUPPORTED.create({
      message: "Cloudflare Workers do not support temporary directories",
      context: { platform: "cloudflare", operation: "makeTempDir" },
    });
  }

  watch(_paths: string | string[], _options?: WatchOptions): FileWatcher {
    throw NOT_SUPPORTED.create({
      message: "Cloudflare Workers do not support file watching",
      context: { platform: "cloudflare", operation: "watch" },
    });
  }
}
