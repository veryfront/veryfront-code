import type { DirEntry, FileInfo, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  createSecureFs,
  type SecureFs,
  type SecurityContext,
} from "#veryfront/security/secure-fs.ts";
import { NOT_SUPPORTED } from "#veryfront/errors";
import type { FileSystemRepository, RepositoryContext } from "../types.ts";
import { snapshotRepositoryContext } from "../context.ts";

function decodeExactUtf8(content: Uint8Array): string {
  const snapshot = content.slice();
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(snapshot);
  } catch {
    throw NOT_SUPPORTED.create({
      detail: "FileSystemRepository byte writes must contain valid UTF-8",
    });
  }

  const roundTrip = new TextEncoder().encode(decoded);
  if (
    roundTrip.byteLength !== snapshot.byteLength ||
    roundTrip.some((byte, index) => byte !== snapshot[index])
  ) {
    throw NOT_SUPPORTED.create({
      detail: "FileSystemRepository byte writes must preserve exact UTF-8 bytes",
    });
  }
  return decoded;
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

  constructor(config: SecureFsRepositoryConfig) {
    this.context = snapshotRepositoryContext(config.context);
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
    await this.secureFs.writeFile(
      path,
      typeof content === "string" ? content : decodeExactUtf8(content),
    );
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
