import {
  FILE_NOT_FOUND,
  INVALID_ARGUMENT,
  NOT_SUPPORTED,
} from "#veryfront/errors/error-registry/general.ts";
import type { ResolveFileOptions } from "../../base.ts";
import type { DirectoryEntry } from "../shared-types.ts";
import { FS_ADAPTER_KIND, type FSAdapter, type FSAdapterConfig } from "../veryfront/types.ts";
import { normalizeMemoryFSPath } from "./path.ts";

const RESOLVE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"] as const;

function fileNotFound(): never {
  throw FILE_NOT_FOUND.create({ message: "Memory filesystem path not found" });
}

function invalidOperation(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail });
}

function encodeFile(value: string | Uint8Array): Uint8Array {
  return typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
}

function parentPath(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator <= 0 ? "/" : path.slice(0, separator);
}

/** Mutable, process-local filesystem used by explicitly ephemeral configurations. */
export class MemoryFSAdapter implements FSAdapter {
  readonly [FS_ADAPTER_KIND] = "memory" as const;

  private readonly files = new Map<string, Uint8Array>();
  private readonly directories = new Set<string>(["/"]);
  private readonly projectDir?: string;
  private disposed = false;

  constructor(config: FSAdapterConfig) {
    this.projectDir = config.projectDir ? normalizeMemoryFSPath(config.projectDir) : undefined;

    const configuredFiles = config.memory?.files ?? {};
    for (const [path, value] of Object.entries(configuredFiles)) {
      const normalizedPath = this.normalize(path);
      if (normalizedPath === "/") {
        invalidOperation("A memory filesystem file path cannot be the root directory");
      }
      if (this.files.has(normalizedPath)) {
        invalidOperation("Memory filesystem configuration contains duplicate normalized paths");
      }
      if (this.directories.has(normalizedPath) || this.hasFileAncestor(normalizedPath)) {
        invalidOperation("Memory filesystem paths cannot be both files and directories");
      }
      this.files.set(normalizedPath, encodeFile(value));
      this.addParentDirectories(normalizedPath);
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    this.assertActive();
    const bytes = this.files.get(this.normalize(path));
    if (!bytes) fileNotFound();
    return new Uint8Array(bytes);
  }

  async readTextFile(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readFile(path));
  }

  async readOptionalTextFile(path: string): Promise<string> {
    this.assertActive();
    const normalizedPath = this.normalize(path);
    if (!this.files.has(normalizedPath)) {
      if (this.directories.has(normalizedPath)) {
        invalidOperation("The memory filesystem path refers to a directory");
      }
      return "";
    }
    return this.readTextFile(normalizedPath);
  }

  async exists(path: string): Promise<boolean> {
    this.assertActive();
    const normalizedPath = this.normalize(path);
    return this.files.has(normalizedPath) || this.directories.has(normalizedPath);
  }

  async stat(path: string): Promise<{
    isFile: boolean;
    isDirectory: boolean;
    isSymlink: boolean;
    size: number;
    mtime: Date | null;
  }> {
    this.assertActive();
    const normalizedPath = this.normalize(path);
    const bytes = this.files.get(normalizedPath);
    if (bytes) {
      return {
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        size: bytes.byteLength,
        mtime: null,
      };
    }
    if (this.directories.has(normalizedPath)) {
      return {
        isFile: false,
        isDirectory: true,
        isSymlink: false,
        size: 0,
        mtime: null,
      };
    }
    return fileNotFound();
  }

  async *readDir(path: string): AsyncIterable<DirectoryEntry> {
    for (const entry of await this.readdir(path)) yield entry;
  }

  async readdir(path: string): Promise<DirectoryEntry[]> {
    this.assertActive();
    const normalizedPath = this.normalize(path);
    if (!this.directories.has(normalizedPath)) fileNotFound();

    const prefix = normalizedPath === "/" ? "/" : `${normalizedPath}/`;
    const childPaths = new Set<string>();
    for (const candidate of [...this.files.keys(), ...this.directories]) {
      if (candidate === normalizedPath || !candidate.startsWith(prefix)) continue;
      const remainder = candidate.slice(prefix.length);
      const name = remainder.split("/", 1)[0];
      if (name) childPaths.add(`${prefix}${name}`);
    }

    return [...childPaths].sort().map((childPath) => ({
      name: childPath.slice(prefix.length),
      path: childPath,
      isDirectory: this.directories.has(childPath),
      isFile: this.files.has(childPath),
      isSymlink: false,
    }));
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.assertActive();
    if (typeof content !== "string") {
      invalidOperation("Memory filesystem file content must be a string");
    }
    const normalizedPath = this.normalize(path);
    if (normalizedPath === "/" || this.directories.has(normalizedPath)) {
      invalidOperation("The memory filesystem path refers to a directory");
    }
    if (!this.directories.has(parentPath(normalizedPath))) fileNotFound();
    this.files.set(normalizedPath, new TextEncoder().encode(content));
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    this.assertActive();
    const normalizedPath = this.normalize(path);
    if (this.files.has(normalizedPath)) {
      invalidOperation("The memory filesystem path refers to a file");
    }
    if (this.hasFileAncestor(normalizedPath)) {
      invalidOperation("Memory filesystem paths cannot be both files and directories");
    }
    if (this.directories.has(normalizedPath)) {
      if (options?.recursive) return;
      invalidOperation("The memory filesystem directory already exists");
    }

    const parent = parentPath(normalizedPath);
    if (!options?.recursive && !this.directories.has(parent)) fileNotFound();
    if (options?.recursive) this.addParentDirectories(`${normalizedPath}/placeholder`);
    this.directories.add(normalizedPath);
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    this.assertActive();
    const normalizedPath = this.normalize(path);
    if (this.files.delete(normalizedPath)) return;
    if (!this.directories.has(normalizedPath)) fileNotFound();
    if (normalizedPath === "/") {
      invalidOperation("The memory filesystem root directory cannot be removed");
    }

    const prefix = `${normalizedPath}/`;
    const hasChildren = [...this.files.keys()].some((candidate) => candidate.startsWith(prefix)) ||
      [...this.directories].some((candidate) => candidate.startsWith(prefix));
    if (hasChildren && !options?.recursive) {
      invalidOperation("The memory filesystem directory is not empty");
    }

    if (options?.recursive) {
      for (const candidate of this.files.keys()) {
        if (candidate.startsWith(prefix)) this.files.delete(candidate);
      }
      for (const candidate of this.directories) {
        if (candidate.startsWith(prefix)) this.directories.delete(candidate);
      }
    }
    this.directories.delete(normalizedPath);
  }

  async resolveFile(basePath: string, options?: ResolveFileOptions): Promise<string | null> {
    this.assertActive();
    const normalizedPath = this.normalize(basePath);
    const resolved = this.tryResolve(normalizedPath);
    if (resolved || options?.allowPagesPrefix === false || normalizedPath.startsWith("/pages/")) {
      return resolved;
    }
    return this.tryResolve(`/pages${normalizedPath}`);
  }

  async shutdown(): Promise<void> {
    this.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.files.clear();
    this.directories.clear();
  }

  private normalize(path: unknown): string {
    return normalizeMemoryFSPath(path, this.projectDir);
  }

  private addParentDirectories(path: string): void {
    let current = parentPath(path);
    while (!this.directories.has(current)) {
      this.directories.add(current);
      if (current === "/") break;
      current = parentPath(current);
    }
  }

  private hasFileAncestor(path: string): boolean {
    let current = parentPath(path);
    while (current !== "/") {
      if (this.files.has(current)) return true;
      current = parentPath(current);
    }
    return false;
  }

  private tryResolve(path: string): string | null {
    if (this.files.has(path)) return path;
    for (const extension of RESOLVE_EXTENSIONS) {
      const candidate = `${path}${extension}`;
      if (this.files.has(candidate)) return candidate;
    }
    for (const extension of RESOLVE_EXTENSIONS) {
      const candidate = `${path}/index${extension}`;
      if (this.files.has(candidate)) return candidate;
    }
    return null;
  }

  private assertActive(): void {
    if (this.disposed) {
      throw NOT_SUPPORTED.create({
        message: "The memory filesystem adapter is closed",
      });
    }
  }
}
