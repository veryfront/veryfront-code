import { CONFIG_INVALID, FILE_NOT_FOUND, NOT_SUPPORTED } from "#veryfront/errors";
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
  if (absolute) return normalized ? `/${normalized}` : "/";
  return normalized;
}

function isVirtualRoot(path: string): boolean {
  return path === "" || path === "/";
}

function getDirectoryPrefix(path: string): string {
  if (isVirtualRoot(path)) return path;
  return `${path}/`;
}

function assertFilePath(path: string, operation: "read" | "remove" | "write"): void {
  if (isVirtualRoot(path)) {
    throw CONFIG_INVALID.create({
      detail: `Cloudflare filesystem cannot ${operation} its virtual root as a file`,
      context: { operation, platform: "cloudflare" },
    });
  }
}

export class CloudflareFileSystemAdapter implements FileSystemAdapter {
  constructor(private kvNamespace?: KVNamespace) {}

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
    return content;
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    const content = await this.readFile(path);
    return new TextEncoder().encode(content);
  }

  async writeFile(path: string, content: string): Promise<void> {
    const normalizedPath = normalizeVirtualPath(path);
    assertFilePath(normalizedPath, "write");
    const kv = this.getKV();
    await kv.put(normalizedPath, content);
  }

  async exists(path: string): Promise<boolean> {
    const normalizedPath = normalizeVirtualPath(path);
    if (!this.kvNamespace) return false;
    if (isVirtualRoot(normalizedPath)) return true;
    const value = await this.kvNamespace.get(normalizedPath);
    if (value !== null) return true;
    const list = await this.kvNamespace.list({
      prefix: getDirectoryPrefix(normalizedPath),
      limit: 1,
    });
    return list.keys.length > 0;
  }

  async *readDir(path: string): AsyncIterable<DirEntry> {
    const normalizedPath = normalizeVirtualPath(path);
    const kv = this.getKV();
    const prefix = getDirectoryPrefix(normalizedPath);
    const list = await kv.list({ prefix });
    const entries = new Map<
      string,
      { name: string; isFile: boolean; isDirectory: boolean; isSymlink: false }
    >();
    for (const key of list.keys) {
      if (!key.name.startsWith(prefix)) continue;
      const relativePath = key.name.slice(prefix.length);
      if (!relativePath || relativePath.startsWith("/")) continue;
      const separatorIndex = relativePath.indexOf("/");
      const name = separatorIndex < 0 ? relativePath : relativePath.slice(0, separatorIndex);
      if (!name) continue;

      const isFile = separatorIndex < 0;
      const existing = entries.get(name);
      if (existing && existing.isFile !== isFile) {
        throw CONFIG_INVALID.create({
          detail: "Cloudflare KV path is both a file and a directory",
          context: { directory: normalizedPath, entryNameLength: name.length },
        });
      }
      entries.set(name, {
        name,
        isFile,
        isDirectory: !isFile,
        isSymlink: false,
      });
    }

    for (
      const entry of [...entries.values()].sort((left, right) =>
        left.name.localeCompare(right.name)
      )
    ) {
      yield entry;
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

    const { value } = await kv.getWithMetadata(normalizedPath);
    if (value !== null) {
      return {
        size: new TextEncoder().encode(value).length,
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        mtime: null,
      };
    }

    const list = await kv.list({
      prefix: getDirectoryPrefix(normalizedPath),
      limit: 1,
    });
    if (list.keys.length > 0) {
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

  mkdir(path: string, _options?: { recursive?: boolean }): Promise<void> {
    normalizeVirtualPath(path);
    return Promise.resolve();
  }

  async remove(path: string, _options?: { recursive?: boolean }): Promise<void> {
    const normalizedPath = normalizeVirtualPath(path);
    assertFilePath(normalizedPath, "remove");
    await this.kvNamespace?.delete(normalizedPath);
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
