/**************************************************
 * Repository Test Mocks
 *
 * Mock implementations for testing without external dependencies.
 * Supports call tracking for assertions.
 *
 * @module repositories/testing
 **************************************************/

import type { DirEntry, FileInfo } from "#veryfront/platform/adapters/base.ts";
import type {
  CacheRepository,
  CacheStats,
  FileSystemRepository,
  RepositoryContext,
} from "../types.ts";
import { FILE_NOT_FOUND, INVALID_ARGUMENT } from "#veryfront/errors";
import {
  DEFAULT_CACHE_TTL_SECONDS,
  requirePositiveIntegerCacheTtlSeconds,
} from "#veryfront/cache/backends/ttl.ts";
import { snapshotRepositoryContext } from "../context.ts";
import { ExpiringLruStore } from "../cache/expiring-lru-store.ts";
import { FileSnapshotChangedError } from "#veryfront/platform/adapters/file-snapshot-error.ts";

export interface TrackedCall {
  method: string;
  args: unknown[];
  timestamp: number;
}

function createEmptyCacheStats(): CacheStats {
  return {
    gets: 0,
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    hitRate: 0,
  };
}

function cloneFileContent(content: string | Uint8Array): string | Uint8Array {
  return content instanceof Uint8Array ? content.slice() : content;
}

export class MockFileSystemRepository implements FileSystemRepository {
  readonly context: RepositoryContext;
  private readonly files = new Map<string, string | Uint8Array>();
  private readonly directories = new Set<string>();
  private readonly calls: TrackedCall[] = [];
  private generation = 0;

  constructor(options: {
    context: RepositoryContext;
    files?: Record<string, string | Uint8Array>;
  }) {
    this.context = snapshotRepositoryContext(options.context);

    for (const [path, content] of Object.entries(options.files ?? {})) {
      this.files.set(path, cloneFileContent(content));
      this.addParentDirectories(path);
    }
  }

  private addParentDirectories(path: string): void {
    let separator = path.lastIndexOf("/");
    while (separator > 0) {
      this.directories.add(path.slice(0, separator));
      separator = path.lastIndexOf("/", separator - 1);
    }
  }

  private parentDirectory(path: string): string | null {
    const separator = path.lastIndexOf("/");
    if (separator < 0) return null;
    return separator === 0 ? "/" : path.slice(0, separator);
  }

  private directoryExists(path: string | null): boolean {
    return path === null || path === "" || path === "." || path === "/" ||
      this.directories.has(path);
  }

  private pathError(code: string, detail: string, path: string): Error {
    const definition = code === "ENOENT" ? FILE_NOT_FOUND : INVALID_ARGUMENT;
    return definition.create({ detail: `${code}: ${detail}: ${path}` });
  }

  private track(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args, timestamp: Date.now() });
  }

  private getStoredContent(path: string): string | Uint8Array {
    const content = this.files.get(path);
    if (content !== undefined) return content;
    throw FILE_NOT_FOUND.create({ detail: `ENOENT: no such file: ${path}` });
  }

  async readFile(path: string): Promise<string> {
    this.track("readFile", path);
    const content = this.getStoredContent(path);

    if (content instanceof Uint8Array) {
      return new TextDecoder().decode(content);
    }

    return content;
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    this.track("readFileBytes", path);
    const content = this.getStoredContent(path);

    if (content instanceof Uint8Array) return content.slice();

    return new TextEncoder().encode(content);
  }

  async readFileSnapshotWithinLimit(path: string, byteLimit: number): Promise<Uint8Array> {
    this.track("readFileSnapshotWithinLimit", path, byteLimit);
    if (!Number.isSafeInteger(byteLimit) || byteLimit <= 0) {
      throw new RangeError("Snapshot byte limit must be a positive safe integer");
    }
    const generation = this.generation;
    const content = this.getStoredContent(path);
    const bytes = content instanceof Uint8Array
      ? content.slice()
      : new TextEncoder().encode(content);
    if (bytes.byteLength > byteLimit) {
      throw new RangeError(`File exceeds byte limit of ${byteLimit} bytes`);
    }

    await Promise.resolve();
    if (generation !== this.generation) {
      throw new FileSnapshotChangedError("File generation changed during snapshot read");
    }
    return bytes;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.track("writeFile", path, content);
    if (typeof content !== "string") {
      throw INVALID_ARGUMENT.create({
        detail: "MockFileSystemRepository.writeFile requires text content",
      });
    }
    if (!this.directoryExists(this.parentDirectory(path))) {
      throw this.pathError("ENOENT", "parent directory does not exist", path);
    }
    if (this.directories.has(path)) {
      throw this.pathError("EISDIR", "path is a directory", path);
    }
    this.files.set(path, content);
    this.generation++;
  }

  async exists(path: string): Promise<boolean> {
    this.track("exists", path);
    return this.files.has(path) || this.directories.has(path);
  }

  async stat(path: string): Promise<FileInfo> {
    this.track("stat", path);

    const isFile = this.files.has(path);
    const isDirectory = this.directories.has(path);

    if (!isFile && !isDirectory) {
      throw FILE_NOT_FOUND.create({ detail: `ENOENT: no such file or directory: ${path}` });
    }

    const content = this.files.get(path);
    const size = typeof content === "string"
      ? new TextEncoder().encode(content).byteLength
      : content?.byteLength ?? 0;

    return {
      size,
      isFile,
      isDirectory,
      isSymlink: false,
      mtime: new Date(),
    };
  }

  async *readDir(path: string): AsyncIterable<DirEntry> {
    this.track("readDir", path);
    if (this.files.has(path)) {
      throw this.pathError("ENOTDIR", "path is not a directory", path);
    }
    if (!this.directoryExists(path)) {
      throw this.pathError("ENOENT", "directory does not exist", path);
    }

    const prefix = path === "." || path === "" ? "" : path.endsWith("/") ? path : `${path}/`;
    const children = new Set<string>();

    for (const filePath of this.files.keys()) {
      if (!filePath.startsWith(prefix)) continue;

      const firstSegment = filePath.slice(prefix.length).split("/")[0];
      if (firstSegment) children.add(firstSegment);
    }

    for (const dirPath of this.directories) {
      if (!dirPath.startsWith(prefix)) continue;

      const firstSegment = dirPath.slice(prefix.length).split("/")[0];
      if (firstSegment) children.add(firstSegment);
    }

    const fileKeys = [...this.files.keys()];

    for (const name of children) {
      const fullPath = `${prefix}${name}`;
      const isFile = this.files.has(fullPath);
      const isDirectory = this.directories.has(fullPath) ||
        fileKeys.some((p) => p.startsWith(`${fullPath}/`));

      yield { name, isFile, isDirectory, isSymlink: false };
    }
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    this.track("mkdir", path, options);

    if (!path) throw this.pathError("EINVAL", "directory path is empty", path);
    if (this.files.has(path)) {
      throw this.pathError("EEXIST", "path already exists", path);
    }
    if (this.directories.has(path)) {
      if (options?.recursive) return;
      throw this.pathError("EEXIST", "path already exists", path);
    }

    if (!options?.recursive) {
      if (!this.directoryExists(this.parentDirectory(path))) {
        throw this.pathError("ENOENT", "parent directory does not exist", path);
      }
      this.directories.add(path);
      return;
    }

    const segments = path.split("/").filter(Boolean);
    let current = path.startsWith("/") ? "/" : "";

    for (const segment of segments) {
      current = current === "/" ? `/${segment}` : current ? `${current}/${segment}` : segment;
      if (this.files.has(current)) {
        throw this.pathError("ENOTDIR", "parent path is a file", current);
      }
      this.directories.add(current);
    }
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    this.track("remove", path, options);

    if (this.files.has(path)) {
      this.files.delete(path);
      this.generation++;
      return;
    }
    if (!this.directories.has(path)) {
      throw this.pathError("ENOENT", "path does not exist", path);
    }

    const prefix = path.endsWith("/") ? path : `${path}/`;
    const hasChildren = [...this.files.keys()].some((key) => key.startsWith(prefix)) ||
      [...this.directories].some((directory) => directory.startsWith(prefix));
    if (hasChildren && !options?.recursive) {
      throw this.pathError("ENOTEMPTY", "directory is not empty", path);
    }

    if (options?.recursive) {
      for (const key of [...this.files.keys()]) {
        if (key.startsWith(prefix)) this.files.delete(key);
      }

      for (const dir of [...this.directories]) {
        if (dir.startsWith(prefix)) this.directories.delete(dir);
      }
    }
    this.directories.delete(path);
    this.generation++;
  }

  setFile(path: string, content: string | Uint8Array): void {
    this.files.set(path, cloneFileContent(content));
    this.addParentDirectories(path);
    this.generation++;
  }

  addDirectory(path: string): void {
    this.directories.add(path);
    this.addParentDirectories(path);
  }

  getAllCalls(): TrackedCall[] {
    return [...this.calls];
  }

  getCalls(method: string): TrackedCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  clearCalls(): void {
    this.calls.length = 0;
  }

  clear(): void {
    this.files.clear();
    this.directories.clear();
    this.calls.length = 0;
    this.generation++;
  }
}

export class MockCacheRepository<T = string> implements CacheRepository<T> {
  readonly context: RepositoryContext;
  private readonly store = new ExpiringLruStore<T>(Number.MAX_SAFE_INTEGER);
  private readonly defaultTtlSeconds: number;
  private readonly calls: TrackedCall[] = [];
  private stats: CacheStats = createEmptyCacheStats();

  constructor(options: {
    context: RepositoryContext;
    initial?: Record<string, T>;
    defaultTtlSeconds?: number;
  }) {
    this.context = snapshotRepositoryContext(options.context);
    this.defaultTtlSeconds = requirePositiveIntegerCacheTtlSeconds(
      options.defaultTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS,
    );

    for (const [key, value] of Object.entries(options.initial ?? {})) {
      this.store.set(key, value);
    }
  }

  private track(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args, timestamp: Date.now() });
  }

  private updateHitRate(): void {
    this.stats.hitRate = this.stats.gets > 0 ? this.stats.hits / this.stats.gets : 0;
  }

  async get(key: string): Promise<T | null> {
    this.track("get", key);
    this.stats.gets++;

    if (!this.store.has(key)) {
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    const value = this.store.get(key) as T;
    this.stats.hits++;
    this.updateHitRate();
    return value;
  }

  async set(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.track("set", key, value, ttlSeconds);
    this.stats.sets++;
    this.store.set(key, value, ttlSeconds, this.defaultTtlSeconds);
  }

  async delete(key: string): Promise<void> {
    this.track("delete", key);
    this.stats.deletes++;
    this.store.delete(key);
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    this.track("deleteByPrefix", prefix);
    const deleted = this.store.deleteByPrefix(prefix);
    this.stats.deletes += deleted;
    return deleted;
  }

  async has(key: string): Promise<boolean> {
    this.track("has", key);
    return this.store.has(key);
  }

  async clear(): Promise<void> {
    this.track("clear");
    this.stats.deletes += this.store.clear();
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  getAllCalls(): TrackedCall[] {
    return [...this.calls];
  }

  getCalls(method: string): TrackedCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  clearCalls(): void {
    this.calls.length = 0;
  }

  resetStats(): void {
    this.stats = createEmptyCacheStats();
  }

  getStore(): Map<string, T> {
    return this.store.snapshot();
  }

  get size(): number {
    return this.store.size;
  }
}

export function createMockRepositoryContext(
  overrides?: Partial<RepositoryContext>,
): RepositoryContext {
  return snapshotRepositoryContext({
    projectId: "test-project",
    environment: "preview",
    versionId: "v1",
    ...overrides,
  });
}
