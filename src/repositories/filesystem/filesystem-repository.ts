import type { DirEntry, FileInfo, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  createSecureFs,
  isSecurityContext,
  type SecureFs,
  type SecurityContext,
} from "#veryfront/security/secure-fs.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import type { FileSystemRepository, RepositoryContext } from "../types.ts";
import { snapshotRepositoryContext } from "../context.ts";

function requireSecurityContext(value: unknown): SecurityContext {
  if (!isSecurityContext(value)) {
    throw INVALID_ARGUMENT.create({
      detail: "SecureFsRepository requires a valid securityContext",
    });
  }
  return value;
}

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
  /** Security policy applied to every path operation */
  securityContext: SecurityContext;
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

  constructor(config: SecureFsRepositoryConfig) {
    this.context = snapshotRepositoryContext(config.context);
    this.secureFs = createSecureFs({
      baseDir: config.baseDir,
      adapter: config.adapter,
      context: requireSecurityContext(config.securityContext),
    });
  }

  readFile(path: string): Promise<string> {
    return this.secureFs.readFile(path);
  }

  readFileBytes(path: string): Promise<Uint8Array> {
    return this.secureFs.readFileBytes(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (typeof content !== "string") {
      throw INVALID_ARGUMENT.create({
        detail: "FileSystemRepository.writeFile requires text content",
      });
    }
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
