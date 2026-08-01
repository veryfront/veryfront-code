import type { DirEntry, FileInfo, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  createSecureFs,
  type SecureFs,
  type SecurityContext,
} from "#veryfront/security/secure-fs.ts";
import type { FileSystemRepository, RepositoryContext } from "../types.ts";

/**
 * Configuration for SecureFsRepository
 */
export interface SecureFsRepositoryConfig {
  /** Base directory for file operations */
  baseDir: string;
  /** Runtime adapter for file system access */
  adapter: RuntimeAdapter;
  /** Repository context for key generation */
  context: RepositoryContext;
  /** Security context for validation (default: "internal") */
  securityContext?: SecurityContext;
  /** Whether to throw on validation errors (default: true) */
  throwOnError?: boolean;
}

/**
 * FileSystem Repository backed by SecureFs
 *
 * Wraps SecureFs to provide project-scoped filesystem operations
 * with the RepositoryContext for cache key generation.
 */
export class SecureFsRepository implements FileSystemRepository {
  private readonly secureFs: SecureFs;
  readonly context: RepositoryContext;
  declare readonly maxWholeFileReadBytes?: number;
  declare readonly readFileBytesBounded?: (
    path: string,
    byteLimit: number,
  ) => Promise<Uint8Array>;
  declare readonly readFileBytesWithinLimit?: (
    path: string,
    byteLimit: number,
  ) => Promise<Uint8Array>;
  declare readonly readFileSnapshotWithinLimit?: (
    path: string,
    byteLimit: number,
  ) => Promise<Uint8Array>;

  constructor(config: SecureFsRepositoryConfig) {
    this.context = config.context;
    this.secureFs = createSecureFs({
      baseDir: config.baseDir,
      adapter: config.adapter,
      context: config.securityContext ?? "internal",
      throwOnError: config.throwOnError ?? true,
    });
    if (this.secureFs.maxWholeFileReadBytes !== undefined) {
      Object.defineProperty(this, "maxWholeFileReadBytes", {
        enumerable: true,
        value: this.secureFs.maxWholeFileReadBytes,
      });
    }
    for (
      const key of [
        "readFileBytesBounded",
        "readFileBytesWithinLimit",
        "readFileSnapshotWithinLimit",
      ] as const
    ) {
      const capability = this.secureFs[key];
      if (capability !== undefined) {
        Object.defineProperty(this, key, {
          enumerable: true,
          value: (path: string, byteLimit: number) => capability(path, byteLimit),
        });
      }
    }
  }

  readFile(path: string): Promise<string> {
    return this.secureFs.readFile(path);
  }

  readFileBytes(path: string): Promise<Uint8Array> {
    return this.secureFs.readFileBytes(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.secureFs.writeFile(path, content);
  }

  exists(path: string): Promise<boolean> {
    return this.secureFs.exists(path);
  }

  stat(path: string): Promise<FileInfo> {
    return this.secureFs.stat(path);
  }

  readDir(path: string): AsyncIterable<DirEntry> {
    return this.secureFs.readDir(path);
  }

  mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    return this.secureFs.mkdir(path, options);
  }

  remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    return this.secureFs.remove(path, options);
  }
}

/**
 * Create a FileSystem repository with the given configuration
 */
export function createFileSystemRepository(
  config: SecureFsRepositoryConfig,
): FileSystemRepository {
  return new SecureFsRepository(config);
}
