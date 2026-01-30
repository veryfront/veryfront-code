/**
 * FileSystem Repository Implementation
 *
 * Wraps SecureFs with RepositoryContext for project-scoped filesystem operations.
 * Provides the same interface as SecureFs for drop-in replacement.
 *
 * @module repositories/filesystem/filesystem-repository
 */

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
 *
 * @example
 * ```typescript
 * const repo = new SecureFsRepository({
 *   baseDir: "/path/to/project",
 *   adapter: runtime.adapter,
 *   context: { projectId: "my-project", environment: "preview", versionId: "v1" },
 *   securityContext: "static-serving",
 * });
 *
 * const content = await repo.readFile("pages/index.mdx");
 * ```
 */
export class SecureFsRepository implements FileSystemRepository {
  private readonly secureFs: SecureFs;
  readonly context: RepositoryContext;

  constructor(config: SecureFsRepositoryConfig) {
    this.context = config.context;
    this.secureFs = createSecureFs({
      baseDir: config.baseDir,
      adapter: config.adapter,
      context: config.securityContext ?? "internal",
      throwOnError: config.throwOnError ?? true,
    });
  }

  readFile(path: string): Promise<string> {
    return this.secureFs.readFile(path);
  }

  readFileBytes(path: string): Promise<Uint8Array> {
    return this.secureFs.readFileBytes(path);
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    if (typeof content === "string") {
      await this.secureFs.writeFile(path, content);
    } else {
      // Convert Uint8Array to string for SecureFs (which only accepts string)
      const text = new TextDecoder().decode(content);
      await this.secureFs.writeFile(path, text);
    }
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

  /**
   * Build a cache key scoped to this repository's context
   *
   * @example
   * ```typescript
   * repo.buildCacheKey("manifest.json")
   * // Returns: "my-project:preview:v1:manifest.json"
   * ```
   */
  buildCacheKey(key: string): string {
    const { projectId, environment, versionId } = this.context;
    return `${projectId}:${environment}:${versionId}:${key}`;
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
