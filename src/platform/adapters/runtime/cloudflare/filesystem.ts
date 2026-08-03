import { CONFIG_INVALID } from "#veryfront/errors/error-registry/config.ts";
import {
  FILE_NOT_FOUND,
  INVALID_ARGUMENT,
  NOT_SUPPORTED,
} from "#veryfront/errors/error-registry/general.ts";
import type {
  DirEntry,
  FileInfo,
  FileSystemAdapter,
  FileWatcher,
  WatchOptions,
} from "../../base.ts";
import type { KVNamespace } from "./types.ts";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import { containsPathControlCharacters } from "#veryfront/utils/route-path-utils.ts";
import {
  copyFixedUint8ArrayWithinLimit,
  getFixedUint8ArrayByteLength,
} from "../../bounded-text-reader.ts";
import { requireBoundedFileReadLimit } from "../../bounded-file-read.ts";

/** @see https://developers.cloudflare.com/kv/platform/limits/ */
const CLOUDFLARE_KV_MAX_KEY_BYTES = 512;
/** @see https://developers.cloudflare.com/kv/platform/limits/ */
const CLOUDFLARE_KV_MAX_VALUE_BYTES = 25 * 1024 * 1024;
/** @see https://developers.cloudflare.com/kv/api/list-keys/ */
const CLOUDFLARE_KV_LIST_PAGE_SIZE = 1_000;
/** Defensive bound aligned with Cloudflare's external-operation ceiling. */
const CLOUDFLARE_KV_MAX_LIST_REQUESTS = 1_000;
const textEncoder = new TextEncoder();

async function readStreamWithinLimit(
  stream: ReadableStream<Uint8Array>,
  byteLimit: number,
): Promise<Uint8Array> {
  const admittedLimit = requireBoundedFileReadLimit(byteLimit);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;

      const chunkBytes = getFixedUint8ArrayByteLength(
        result.value,
        "Cloudflare KV stream chunk",
      );
      if (chunkBytes > admittedLimit - totalBytes) {
        throw new RangeError(`Cloudflare KV value exceeds ${admittedLimit} bytes`);
      }
      if (chunkBytes === 0) continue;

      chunks.push(
        copyFixedUint8ArrayWithinLimit(
          result.value,
          chunkBytes,
          "Cloudflare KV stream chunk",
        ),
      );
      totalBytes += chunkBytes;
    }
  } catch (readError) {
    try {
      await reader.cancel(readError);
    } catch (cancelError) {
      throw new AggregateError(
        [readError, cancelError],
        "Cloudflare KV bounded read and stream cancellation both failed",
      );
    }
    throw readError;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function utf8ByteLength(value: string, stopAfter = Number.POSITIVE_INFINITY): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes++;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < value.length
    ) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > stopAfter) return bytes;
  }
  return bytes;
}

function assertKvKeySize(path: string): void {
  const size = utf8ByteLength(path);
  if (size > CLOUDFLARE_KV_MAX_KEY_BYTES) {
    throw CONFIG_INVALID.create({
      detail: `Cloudflare filesystem path exceeds the 512-byte KV key limit`,
      context: {
        keyBytes: size,
        maxKeyBytes: CLOUDFLARE_KV_MAX_KEY_BYTES,
      },
    });
  }
}

function normalizeVirtualPath(path: string): string {
  if (typeof path !== "string" || path.length > MAX_PATH_LENGTH_CHARS) {
    throw CONFIG_INVALID.create({
      detail: "Cloudflare filesystem path exceeds the supported boundary",
      context: {
        maxPathLength: MAX_PATH_LENGTH_CHARS,
        pathLength: typeof path === "string" ? path.length : undefined,
      },
    });
  }
  if (containsPathControlCharacters(path)) {
    throw CONFIG_INVALID.create({
      detail: "Cloudflare filesystem path contains control characters",
      context: { pathLength: path.length },
    });
  }

  const normalizedSeparators = path.replaceAll("\\", "/");
  const absolute = normalizedSeparators.startsWith("/");
  const segments: string[] = [];
  for (const segment of normalizedSeparators.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      const previous = segments.at(-1);
      if (previous && previous !== "..") {
        segments.pop();
      } else {
        throw CONFIG_INVALID.create({
          detail: "Cloudflare filesystem path escapes its lexical root",
          context: { absolute },
        });
      }
      continue;
    }
    segments.push(segment);
  }

  const normalized = segments.join("/");
  const result = absolute ? (normalized ? `/${normalized}` : "/") : normalized;
  assertKvKeySize(result);
  return result;
}

function isVirtualRoot(path: string): boolean {
  return path === "" || path === "/";
}

function getDirectoryPrefix(path: string): string {
  if (isVirtualRoot(path)) return path;
  return `${path}/`;
}

function isUsableDirectoryPrefix(prefix: string): boolean {
  return utf8ByteLength(prefix) <= CLOUDFLARE_KV_MAX_KEY_BYTES;
}

function assertFilePath(path: string, operation: "read" | "remove" | "write"): void {
  if (isVirtualRoot(path)) {
    throw CONFIG_INVALID.create({
      detail: `Cloudflare filesystem cannot ${operation} its virtual root as a file`,
      context: { operation, platform: "cloudflare" },
    });
  }
}

function assertStoredKey(prefix: string, key: unknown): asserts key is string {
  if (typeof key !== "string" || !key.startsWith(prefix)) {
    throw CONFIG_INVALID.create({
      detail: "Cloudflare KV returned a key outside the requested prefix",
      context: { prefixLength: prefix.length },
    });
  }
  assertKvKeySize(key);
  const canonicalPath = key.endsWith("/") ? key.slice(0, -1) : key;
  if (
    isVirtualRoot(canonicalPath) ||
    normalizeVirtualPath(canonicalPath) !== canonicalPath
  ) {
    throw CONFIG_INVALID.create({
      detail: "Cloudflare KV returned a non-canonical filesystem key",
      context: { keyLength: key.length },
    });
  }
}

async function* listKeys(
  kv: KVNamespace,
  prefix: string,
  limit = CLOUDFLARE_KV_LIST_PAGE_SIZE,
): AsyncIterable<string> {
  let cursor: string | undefined;
  const observedCursors = new Set<string>();
  let previousKeyBytes: Uint8Array | undefined;

  for (
    let requestCount = 0;
    requestCount < CLOUDFLARE_KV_MAX_LIST_REQUESTS;
    requestCount++
  ) {
    const page = await kv.list({
      prefix,
      limit,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!page || !Array.isArray(page.keys) || typeof page.list_complete !== "boolean") {
      throw CONFIG_INVALID.create({
        detail: "Cloudflare KV returned an invalid list response",
      });
    }

    for (const entry of page.keys) {
      const name = entry?.name;
      assertStoredKey(prefix, name);
      const keyBytes = textEncoder.encode(name);
      if (
        previousKeyBytes !== undefined &&
        compareBytes(previousKeyBytes, keyBytes) >= 0
      ) {
        throw CONFIG_INVALID.create({
          detail: "Cloudflare KV returned duplicate or unsorted list keys",
        });
      }
      previousKeyBytes = keyBytes;
      yield name;
    }

    if (page.list_complete) return;

    const nextCursor = page.cursor;
    if (
      typeof nextCursor !== "string" ||
      nextCursor.length === 0 ||
      observedCursors.has(nextCursor)
    ) {
      throw CONFIG_INVALID.create({
        detail: "Cloudflare KV returned an invalid pagination cursor",
      });
    }
    observedCursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw CONFIG_INVALID.create({
    detail: `Cloudflare KV directory listing exceeds ${CLOUDFLARE_KV_MAX_LIST_REQUESTS} pages`,
    context: { maxListRequests: CLOUDFLARE_KV_MAX_LIST_REQUESTS },
  });
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const commonLength = Math.min(left.length, right.length);
  for (let index = 0; index < commonLength; index++) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

async function hasKeyWithPrefix(kv: KVNamespace, prefix: string): Promise<boolean> {
  if (!isUsableDirectoryPrefix(prefix)) return false;
  for await (const _key of listKeys(kv, prefix, 1)) return true;
  return false;
}

async function inspectDirectory(
  kv: KVNamespace,
  prefix: string,
): Promise<{ hasMarker: boolean; hasChildren: boolean }> {
  if (!isUsableDirectoryPrefix(prefix)) {
    return { hasMarker: false, hasChildren: false };
  }

  let hasMarker = false;
  let hasChildren = false;
  for await (const key of listKeys(kv, prefix, 2)) {
    if (key === prefix) hasMarker = true;
    else {
      hasChildren = true;
      // KV lists keys lexicographically. The marker is the prefix itself and
      // therefore cannot appear after a child key.
      if (!hasMarker) return { hasMarker: false, hasChildren: true };
    }
    if (hasChildren) break;
  }
  return { hasMarker, hasChildren };
}

function getParentPaths(path: string): string[] {
  const absolute = path.startsWith("/");
  const segments = path.split("/").filter(Boolean);
  const parents: string[] = [];
  for (let length = 1; length < segments.length; length++) {
    parents.push(`${absolute ? "/" : ""}${segments.slice(0, length).join("/")}`);
  }
  return parents;
}

function getImmediateParent(path: string): string | undefined {
  return getParentPaths(path).at(-1);
}

function getDirectoryMarker(path: string): string {
  const marker = getDirectoryPrefix(path);
  if (!isUsableDirectoryPrefix(marker)) {
    throw CONFIG_INVALID.create({
      detail: "Cloudflare filesystem directory marker exceeds the 512-byte KV key limit",
      context: { path },
    });
  }
  return marker;
}

async function assertNoFileParents(kv: KVNamespace, path: string): Promise<void> {
  for (const parent of getParentPaths(path)) {
    if (await kv.get(parent) !== null) {
      throw CONFIG_INVALID.create({
        detail: "Cloudflare filesystem parent path is a file",
        context: { path, parent },
      });
    }
  }
}

async function assertWritableFilePath(kv: KVNamespace, path: string): Promise<void> {
  await assertNoFileParents(kv, path);
  if (await hasKeyWithPrefix(kv, getDirectoryPrefix(path))) {
    throw CONFIG_INVALID.create({
      detail: "Cloudflare filesystem target is an existing directory",
      context: { path },
    });
  }
}

export class CloudflareFileSystemAdapter implements FileSystemAdapter {
  readonly symlinkSemantics = "none" as const;
  readonly maxWholeFileReadBytes = CLOUDFLARE_KV_MAX_VALUE_BYTES;

  constructor(private readonly kvNamespace?: KVNamespace) {}

  private getKV(): KVNamespace {
    const kv = this.kvNamespace;
    if (!kv) {
      throw CONFIG_INVALID.create({
        detail: "KV namespace required for file operations in Workers",
        context: { platform: "cloudflare" },
      });
    }
    return kv;
  }

  async readFile(path: string): Promise<string> {
    const normalizedPath = normalizeVirtualPath(path);
    assertFilePath(normalizedPath, "read");
    const kv = this.getKV();
    const content = await kv.get(normalizedPath);
    if (content === null) {
      throw FILE_NOT_FOUND.create({
        detail: `File not found: ${normalizedPath}`,
        context: { path: normalizedPath },
      });
    }
    if (typeof content !== "string") {
      throw CONFIG_INVALID.create({
        detail: "Cloudflare KV returned a non-text response for a text read",
      });
    }
    return content;
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    const normalizedPath = normalizeVirtualPath(path);
    assertFilePath(normalizedPath, "read");
    const content = await this.getKV().get(normalizedPath, "arrayBuffer");
    if (content === null) {
      throw FILE_NOT_FOUND.create({
        detail: `File not found: ${normalizedPath}`,
        context: { path: normalizedPath },
      });
    }
    if (content instanceof ArrayBuffer) return new Uint8Array(content);
    if (typeof content === "string") return textEncoder.encode(content);
    throw CONFIG_INVALID.create({
      detail: "Cloudflare KV returned a non-binary response for a binary read",
    });
  }

  async readFileBytesWithinLimit(path: string, byteLimit: number): Promise<Uint8Array> {
    const admittedLimit = requireBoundedFileReadLimit(byteLimit);
    const normalizedPath = normalizeVirtualPath(path);
    assertFilePath(normalizedPath, "read");
    const content = await this.getKV().get(normalizedPath, "stream");
    if (content === null) {
      throw FILE_NOT_FOUND.create({
        detail: `File not found: ${normalizedPath}`,
        context: { path: normalizedPath },
      });
    }
    if (!(content instanceof ReadableStream)) {
      throw CONFIG_INVALID.create({
        detail: "Cloudflare KV returned a non-stream response for a bounded read",
      });
    }
    return await readStreamWithinLimit(content, admittedLimit);
  }

  async writeFile(path: string, content: string): Promise<void> {
    const normalizedPath = normalizeVirtualPath(path);
    assertFilePath(normalizedPath, "write");
    if (typeof content !== "string") {
      throw CONFIG_INVALID.create({
        detail: "Cloudflare filesystem content must be a string",
      });
    }
    const contentBytes = utf8ByteLength(content, CLOUDFLARE_KV_MAX_VALUE_BYTES);
    if (contentBytes > CLOUDFLARE_KV_MAX_VALUE_BYTES) {
      throw CONFIG_INVALID.create({
        detail: "Cloudflare filesystem content exceeds the 25 MiB KV value limit",
        context: {
          contentBytes,
          maxValueBytes: CLOUDFLARE_KV_MAX_VALUE_BYTES,
        },
      });
    }
    const kv = this.getKV();
    await assertWritableFilePath(kv, normalizedPath);
    await kv.put(normalizedPath, content);
  }

  async writeFileBytes(path: string, content: Uint8Array): Promise<void> {
    const normalizedPath = normalizeVirtualPath(path);
    assertFilePath(normalizedPath, "write");
    if (content.byteLength > CLOUDFLARE_KV_MAX_VALUE_BYTES) {
      throw CONFIG_INVALID.create({
        detail: "Cloudflare filesystem content exceeds the 25 MiB KV value limit",
        context: {
          contentBytes: content.byteLength,
          maxValueBytes: CLOUDFLARE_KV_MAX_VALUE_BYTES,
        },
      });
    }
    const kv = this.getKV();
    await assertWritableFilePath(kv, normalizedPath);
    await kv.put(normalizedPath, content.slice());
  }

  async exists(path: string): Promise<boolean> {
    const normalizedPath = normalizeVirtualPath(path);
    if (!this.kvNamespace) return false;
    if (isVirtualRoot(normalizedPath)) return true;
    const value = await this.kvNamespace.get(normalizedPath);
    if (value !== null) return true;
    return await hasKeyWithPrefix(
      this.kvNamespace,
      getDirectoryPrefix(normalizedPath),
    );
  }

  async *readDir(path: string): AsyncIterable<DirEntry> {
    const normalizedPath = normalizeVirtualPath(path);
    const kv = this.getKV();
    const prefix = getDirectoryPrefix(normalizedPath);
    if (!isUsableDirectoryPrefix(prefix)) return;

    let currentName: string | undefined;
    let currentIsFile = false;
    let currentIsDirectory = false;

    for await (const key of listKeys(kv, prefix)) {
      const relativePath = key.slice(prefix.length);
      if (!relativePath || relativePath.startsWith("/")) continue;
      const separatorIndex = relativePath.indexOf("/");
      const name = separatorIndex < 0 ? relativePath : relativePath.slice(0, separatorIndex);
      if (!name) continue;

      const isFile = separatorIndex < 0;
      if (currentName !== undefined && currentName !== name) {
        if (currentIsFile && currentIsDirectory) {
          throw CONFIG_INVALID.create({
            detail: "Cloudflare KV path is both a file and a directory",
            context: { directory: normalizedPath, entryNameLength: currentName.length },
          });
        }
        yield {
          name: currentName,
          isFile: currentIsFile,
          isDirectory: currentIsDirectory,
          isSymlink: false,
        };
        currentIsFile = false;
        currentIsDirectory = false;
      }

      currentName = name;
      if (isFile) currentIsFile = true;
      else currentIsDirectory = true;
    }

    if (currentName !== undefined) {
      if (currentIsFile && currentIsDirectory) {
        throw CONFIG_INVALID.create({
          detail: "Cloudflare KV path is both a file and a directory",
          context: { directory: normalizedPath, entryNameLength: currentName.length },
        });
      }
      yield {
        name: currentName,
        isFile: currentIsFile,
        isDirectory: currentIsDirectory,
        isSymlink: false,
      };
    }
  }

  async stat(path: string): Promise<FileInfo> {
    const normalizedPath = normalizeVirtualPath(path);
    const kv = this.getKV();
    if (isVirtualRoot(normalizedPath)) {
      return {
        size: 0,
        isFile: false,
        isDirectory: true,
        isSymlink: false,
        mtime: null,
      };
    }

    const value = await kv.get(normalizedPath, "arrayBuffer");
    if (value !== null) {
      if (!(value instanceof ArrayBuffer)) {
        throw CONFIG_INVALID.create({
          detail: "Cloudflare KV returned a non-binary response for file metadata",
        });
      }
      return {
        size: value.byteLength,
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        mtime: null,
      };
    }

    if (await hasKeyWithPrefix(kv, getDirectoryPrefix(normalizedPath))) {
      return {
        size: 0,
        isFile: false,
        isDirectory: true,
        isSymlink: false,
        mtime: null,
      };
    }

    throw FILE_NOT_FOUND.create({
      detail: `File not found: ${normalizedPath}`,
      context: { path: normalizedPath },
    });
  }

  /**
   * Returns the canonical KV key for an existing path.
   *
   * Cloudflare KV has no symlinks, so lexical dot-segment normalization is its
   * physical-path canonicalization. Verifying the normalized key exists keeps
   * the contract aligned with native `realpath` implementations.
   */
  async realPath(path: string): Promise<string> {
    const normalizedPath = normalizeVirtualPath(path);
    await this.stat(normalizedPath);
    return normalizedPath;
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const normalizedPath = normalizeVirtualPath(path);
    const kv = this.getKV();
    if (isVirtualRoot(normalizedPath)) return;
    await assertNoFileParents(kv, normalizedPath);
    if (await kv.get(normalizedPath) !== null) {
      throw CONFIG_INVALID.create({
        detail: "Cloudflare filesystem cannot create a directory over an existing file",
        context: { path: normalizedPath },
      });
    }

    const parents = getParentPaths(normalizedPath);
    if (!options?.recursive) {
      const parent = getImmediateParent(normalizedPath);
      if (
        parent !== undefined &&
        !await hasKeyWithPrefix(kv, getDirectoryPrefix(parent))
      ) {
        throw FILE_NOT_FOUND.create({
          detail: `Parent directory not found: ${parent}`,
          context: { path: normalizedPath, parent },
        });
      }
    }

    const directories = options?.recursive ? [...parents, normalizedPath] : [normalizedPath];
    const markers = directories.map(getDirectoryMarker);
    for (const marker of markers) {
      await kv.put(marker, "");
    }
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    const normalizedPath = normalizeVirtualPath(path);
    assertFilePath(normalizedPath, "remove");
    const kv = this.getKV();
    const existingFile = await kv.get(normalizedPath);
    const prefix = getDirectoryPrefix(normalizedPath);
    const { hasMarker, hasChildren } = await inspectDirectory(kv, prefix);

    if (existingFile !== null && (hasMarker || hasChildren)) {
      throw CONFIG_INVALID.create({
        detail: "Cloudflare KV path is both a file and a directory",
        context: { path: normalizedPath },
      });
    }
    if (hasChildren) {
      if (!options?.recursive) {
        throw INVALID_ARGUMENT.create({
          detail: "Cloudflare filesystem directory is not empty",
          context: { path: normalizedPath, platform: "cloudflare", operation: "remove" },
        });
      }
      throw NOT_SUPPORTED.create({
        detail:
          "Cloudflare KV directory removal is not supported because per-key deletion is not atomic",
        context: { path: normalizedPath, platform: "cloudflare", operation: "remove" },
      });
    }
    if (hasMarker) {
      await kv.delete(prefix);
      return;
    }
    if (existingFile !== null) await kv.delete(normalizedPath);
  }

  makeTempDir(_prefix: string): Promise<string> {
    throw NOT_SUPPORTED.create({
      detail: "Temporary directories not supported in Cloudflare Workers",
      context: { platform: "cloudflare", operation: "makeTempDir" },
    });
  }

  watch(_paths: string | string[], _options?: WatchOptions): FileWatcher {
    throw NOT_SUPPORTED.create({
      detail: "File watching not supported in Cloudflare Workers",
      context: { platform: "cloudflare", operation: "watch" },
    });
  }
}
