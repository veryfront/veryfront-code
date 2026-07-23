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
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { snapshotRepositoryContext } from "../context.ts";
import {
  DEFAULT_REPOSITORY_CACHE_TTL_SECONDS,
  MAX_REPOSITORY_CACHE_TTL_SECONDS,
} from "../limits.ts";

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
  return typeof content === "string" ? content : content.slice();
}

function cloneTrackedCall(call: TrackedCall): TrackedCall {
  return {
    method: call.method,
    args: call.args.map((argument) => argument instanceof Uint8Array ? argument.slice() : argument),
    timestamp: call.timestamp,
  };
}

export class MockFileSystemRepository implements FileSystemRepository {
  readonly context: RepositoryContext;
  private readonly files = new Map<string, string | Uint8Array>();
  private readonly directories = new Set<string>();
  private readonly calls: TrackedCall[] = [];

  constructor(options: {
    context: RepositoryContext;
    files?: Record<string, string | Uint8Array>;
  }) {
    this.context = snapshotRepositoryContext(options.context);

    for (const [path, content] of Object.entries(options.files ?? {})) {
      this.files.set(path, cloneFileContent(content));
    }
  }

  private track(method: string, ...args: unknown[]): void {
    this.calls.push(cloneTrackedCall({ method, args, timestamp: Date.now() }));
  }

  private isDirectory(path: string): boolean {
    if (this.directories.has(path)) return true;
    const prefix = path.endsWith("/") ? path : `${path}/`;
    for (const file of this.files.keys()) {
      if (file.startsWith(prefix)) return true;
    }
    for (const directory of this.directories) {
      if (directory.startsWith(prefix)) return true;
    }
    return false;
  }

  private getStoredContent(path: string): string | Uint8Array {
    const content = this.files.get(path);
    if (content !== undefined) return content;
    throw INVALID_ARGUMENT.create({ detail: `ENOENT: no such file: ${path}` });
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

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    this.track("writeFile", path, content);
    this.files.set(path, cloneFileContent(content));
  }

  async exists(path: string): Promise<boolean> {
    this.track("exists", path);
    return this.files.has(path) || this.isDirectory(path);
  }

  async stat(path: string): Promise<FileInfo> {
    this.track("stat", path);

    const isFile = this.files.has(path);
    const isDirectory = this.isDirectory(path);

    if (!isFile && !isDirectory) {
      throw INVALID_ARGUMENT.create({ detail: `ENOENT: no such file or directory: ${path}` });
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

    const prefix = path.endsWith("/") ? path : `${path}/`;
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

    if (!options?.recursive) {
      this.directories.add(path);
      return;
    }

    const segments = path.split("/").filter(Boolean);
    let current = path.startsWith("/") ? "/" : "";

    for (const segment of segments) {
      current = current === "/" ? `/${segment}` : current ? `${current}/${segment}` : segment;
      this.directories.add(current);
    }
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    this.track("remove", path, options);

    if (!options?.recursive) {
      this.files.delete(path);
      this.directories.delete(path);
      return;
    }

    const prefix = path.endsWith("/") ? path : `${path}/`;

    for (const key of [...this.files.keys()]) {
      if (key === path || key.startsWith(prefix)) this.files.delete(key);
    }

    for (const dir of [...this.directories]) {
      if (dir === path || dir.startsWith(prefix)) this.directories.delete(dir);
    }
  }

  setFile(path: string, content: string | Uint8Array): void {
    this.files.set(path, cloneFileContent(content));
  }

  addDirectory(path: string): void {
    this.directories.add(path);
  }

  getAllCalls(): TrackedCall[] {
    return this.calls.map(cloneTrackedCall);
  }

  getCalls(method: string): TrackedCall[] {
    return this.calls.filter((call) => call.method === method).map(cloneTrackedCall);
  }

  clearCalls(): void {
    this.calls.length = 0;
  }

  clear(): void {
    this.files.clear();
    this.directories.clear();
    this.calls.length = 0;
  }
}

export class MockCacheRepository<T = string> implements CacheRepository<T> {
  readonly context: RepositoryContext;
  private readonly store = new Map<string, { value: T; expiresAt: number | null }>();
  private readonly calls: TrackedCall[] = [];
  private stats: CacheStats = createEmptyCacheStats();

  constructor(options: { context: RepositoryContext; initial?: Record<string, T> }) {
    this.context = snapshotRepositoryContext(options.context);

    for (const [key, value] of Object.entries(options.initial ?? {})) {
      this.store.set(key, { value, expiresAt: null });
    }
  }

  private track(method: string, ...args: unknown[]): void {
    this.calls.push(cloneTrackedCall({ method, args, timestamp: Date.now() }));
  }

  private updateHitRate(): void {
    this.stats.hitRate = this.stats.gets > 0 ? this.stats.hits / this.stats.gets : 0;
  }

  async get(key: string): Promise<T | null> {
    this.track("get", key);
    this.stats.gets++;

    const entry = this.store.get(key);
    if (!entry || (entry.expiresAt !== null && Date.now() >= entry.expiresAt)) {
      if (entry) this.store.delete(key);
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    this.stats.hits++;
    this.updateHitRate();
    return entry.value;
  }

  async set(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.track("set", key, value, ttlSeconds);
    if (
      ttlSeconds !== undefined &&
      (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0 ||
        ttlSeconds > MAX_REPOSITORY_CACHE_TTL_SECONDS)
    ) {
      throw INVALID_ARGUMENT.create({ detail: "Cache TTL is outside the supported range" });
    }
    this.stats.sets++;
    this.store.set(key, {
      value,
      expiresAt: Date.now() +
        (ttlSeconds ?? DEFAULT_REPOSITORY_CACHE_TTL_SECONDS) * 1000,
    });
  }

  async delete(key: string): Promise<void> {
    this.track("delete", key);
    this.stats.deletes++;
    this.store.delete(key);
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    this.track("deleteByPrefix", prefix);

    let deleted = 0;

    for (const key of [...this.store.keys()]) {
      if (!key.startsWith(prefix)) continue;

      this.store.delete(key);
      deleted++;
      this.stats.deletes++;
    }

    return deleted;
  }

  async has(key: string): Promise<boolean> {
    this.track("has", key);
    const entry = this.store.get(key);
    if (!entry) return false;
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  async clear(): Promise<void> {
    this.track("clear");
    this.stats.deletes += this.store.size;
    this.store.clear();
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  getAllCalls(): TrackedCall[] {
    return this.calls.map(cloneTrackedCall);
  }

  getCalls(method: string): TrackedCall[] {
    return this.calls.filter((call) => call.method === method).map(cloneTrackedCall);
  }

  clearCalls(): void {
    this.calls.length = 0;
  }

  resetStats(): void {
    this.stats = createEmptyCacheStats();
  }

  getStore(): Map<string, T> {
    const snapshot = new Map<string, T>();
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt !== null && now >= entry.expiresAt) {
        this.store.delete(key);
        continue;
      }
      snapshot.set(key, entry.value);
    }
    return snapshot;
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
