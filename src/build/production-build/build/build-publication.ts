import { basename, dirname, join, resolve } from "#veryfront/compat/path/index.ts";
import {
  createFileSystem,
  isAlreadyExistsError,
  isNotFoundError,
} from "#veryfront/platform/compat/fs.ts";
import { BUILD_FAILED } from "#veryfront/errors";
import { serverLogger } from "#veryfront/utils";

const logger = serverLogger.component("build-publication");
const DEFAULT_LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_INITIAL_MS = 10;
const LOCK_RETRY_MAX_MS = 100;

declare const buildOutputOwnershipBrand: unique symbol;

export interface BuildOutputOwnership {
  readonly [buildOutputOwnershipBrand]: true;
}

export type BuildPublication =
  | {
    readonly dryRun: true;
    readonly finalDir: string;
    readonly buildDir: string;
    publish(): Promise<void>;
    cleanup(): Promise<void>;
  }
  | {
    readonly dryRun: false;
    readonly finalDir: string;
    readonly buildDir: string;
    readonly outputOwnership: BuildOutputOwnership;
    publish(): Promise<void>;
    cleanup(): Promise<void>;
  };

export interface BuildPublicationDependencies {
  fs?: BuildPublicationFileSystem;
  lockTimeoutMs?: number;
}

export interface BuildPublicationFileSystem {
  rename?(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
}

export interface OwnedBuildDirectoryFileSystem extends BuildPublicationFileSystem {
  stat(path: string): Promise<{
    readonly isDirectory: boolean;
    readonly isFile: boolean;
    readonly isSymlink?: boolean;
  }>;
  lstat?(path: string): Promise<{
    readonly isDirectory: boolean;
    readonly isFile: boolean;
    readonly isSymlink?: boolean;
  }>;
  readonly symlinkSemantics?: unknown;
}

type BuildOutputLifecycle =
  | "live"
  | "publishing"
  | "published"
  | "cleanup-started"
  | "cleaned";

interface BuildOutputOwnershipRecord {
  readonly buildDir: string;
  readonly fileSystem: BuildPublicationFileSystem;
  readonly generation: string;
  lifecycle: BuildOutputLifecycle;
}

const buildOutputOwnershipRecords = new WeakMap<
  BuildOutputOwnership,
  BuildOutputOwnershipRecord
>();
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const MAX_OWNED_DESCENDANT_PATH_LENGTH = 4_096;
const MAX_OWNED_DESCENDANT_DEPTH = 64;

function publicationError(detail: string, cause?: unknown): Error {
  return BUILD_FAILED.create({ detail, cause });
}

export function resolveBuildOutputOwnership(
  output: BuildOutputOwnership,
  expectedFileSystem: BuildPublicationFileSystem,
): string {
  const record = buildOutputOwnershipRecords.get(output);
  if (
    !record || record.lifecycle !== "live" ||
    record.fileSystem !== expectedFileSystem
  ) {
    throw publicationError(
      "Build output ownership is invalid, expired, or belongs to another filesystem",
    );
  }
  return record.buildDir;
}

function splitOwnedDescendantPath(relativePath: string): string[] {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    relativePath.length > MAX_OWNED_DESCENDANT_PATH_LENGTH ||
    relativePath !== relativePath.normalize("NFC")
  ) {
    throw new TypeError("Owned build output requires a safe relative descendant path");
  }

  const segments: string[] = [];
  let segmentStart = 0;
  for (let index = 0; index <= relativePath.length; index++) {
    const atEnd = index === relativePath.length;
    const code = atEnd ? 0x2f : relativePath.charCodeAt(index);
    if (!atEnd && (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x5c)) {
      throw new TypeError("Owned build output requires a safe relative descendant path");
    }
    if (!atEnd && code !== 0x2f) continue;

    const segment = relativePath.slice(segmentStart, index);
    if (segment === "" || segment === "." || segment === ".." || segment.includes(":")) {
      throw new TypeError("Owned build output requires a safe relative descendant path");
    }
    segments.push(segment);
    if (segments.length > MAX_OWNED_DESCENDANT_DEPTH) {
      throw new TypeError("Owned build output requires a safe relative descendant path");
    }
    segmentStart = index + 1;
  }
  return segments;
}

function hasOwnNoSymlinkSemantics(fileSystem: object): boolean {
  try {
    const descriptor = getOwnPropertyDescriptor(fileSystem, "symlinkSemantics");
    return descriptor !== undefined && "value" in descriptor && descriptor.value === "none";
  } catch {
    return false;
  }
}

async function assertRealDirectory(
  fileSystem: OwnedBuildDirectoryFileSystem,
  path: string,
): Promise<void> {
  const lstat = fileSystem.lstat?.bind(fileSystem);
  if (!lstat && !hasOwnNoSymlinkSemantics(fileSystem)) {
    throw new TypeError(
      `Owned build output directory reuse requires non-following metadata: ${path}`,
    );
  }
  const info = lstat ? await lstat(path) : await fileSystem.stat(path);
  if (info.isSymlink || !info.isDirectory || info.isFile) {
    throw new TypeError(`Owned build output path is not a real directory: ${path}`);
  }
}

async function createOrReuseOwnedDirectory(
  fileSystem: OwnedBuildDirectoryFileSystem,
  path: string,
): Promise<void> {
  try {
    await assertRealDirectory(fileSystem, path);
    return;
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  try {
    await fileSystem.mkdir(path);
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
    await assertRealDirectory(fileSystem, path);
  }
}

export async function ensureOwnedBuildDescendant(
  output: BuildOutputOwnership,
  expectedFileSystem: OwnedBuildDirectoryFileSystem,
  relativePath: string,
): Promise<string> {
  const segments = splitOwnedDescendantPath(relativePath);
  const buildDir = resolveBuildOutputOwnership(output, expectedFileSystem);
  await assertRealDirectory(expectedFileSystem, buildDir);

  let current = buildDir;
  for (const segment of segments) {
    current = join(current, segment);
    await createOrReuseOwnedDirectory(expectedFileSystem, current);
  }
  return current;
}

async function acquireBuildLock(
  lockPath: string,
  timeoutMs: number,
): Promise<() => Promise<void>> {
  const nodeFs = await import("node:fs/promises");
  const token = crypto.randomUUID();
  const content = `${JSON.stringify({ token, createdAt: new Date().toISOString() })}\n`;
  const startedAt = Date.now();
  let retryDelayMs = LOCK_RETRY_INITIAL_MS;

  while (true) {
    let handle: Awaited<ReturnType<typeof nodeFs.open>> | undefined;
    let ownsLock = false;
    try {
      handle = await nodeFs.open(lockPath, "wx");
      ownsLock = true;
      await handle.writeFile(content, { encoding: "utf8" });
      await handle.sync();
      await handle.close();
      handle = undefined;
      break;
    } catch (error) {
      const cleanupErrors: unknown[] = [];
      if (handle) {
        try {
          await handle.close();
        } catch (closeError) {
          cleanupErrors.push(
            publicationError(
              `Failed to close incomplete build output lock: ${lockPath}`,
              closeError,
            ),
          );
        }
      }

      const lockAlreadyExists = !ownsLock &&
        (error as NodeJS.ErrnoException).code === "EEXIST";
      if (!lockAlreadyExists) {
        if (ownsLock) {
          try {
            await nodeFs.rm(lockPath, { force: true });
          } catch (removeError) {
            cleanupErrors.push(
              publicationError(
                `Failed to remove incomplete build output lock: ${lockPath}`,
                removeError,
              ),
            );
          }
        }
        const acquisitionError = publicationError(
          `Failed to acquire build output lock: ${lockPath}`,
          error,
        );
        if (cleanupErrors.length > 0) {
          throw new AggregateError(
            [acquisitionError, ...cleanupErrors],
            "Build output lock setup failed and cleanup also failed",
          );
        }
        throw acquisitionError;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw publicationError(
          `Timed out waiting for build output lock ${lockPath}; ` +
            "confirm no build is active before removing the lock",
        );
      }
      await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, retryDelayMs));
      retryDelayMs = Math.min(retryDelayMs * 2, LOCK_RETRY_MAX_MS);
    }
  }

  let released = false;
  let releaseInFlight: Promise<void> | undefined;
  return async (): Promise<void> => {
    if (released) return;
    if (releaseInFlight) return await releaseInFlight;

    const operation = (async (): Promise<void> => {
      const current = await nodeFs.readFile(lockPath, "utf8").catch((error) => {
        throw publicationError(`Failed to verify build output lock: ${lockPath}`, error);
      });
      if (current !== content) {
        throw publicationError(`Build output lock ownership changed unexpectedly: ${lockPath}`);
      }
      await nodeFs.rm(lockPath);
      released = true;
    })();
    releaseInFlight = operation;
    try {
      await operation;
    } finally {
      if (releaseInFlight === operation) releaseInFlight = undefined;
    }
  };
}

export async function createBuildPublication(
  outputDir: string,
  dryRun: boolean,
  dependencies: BuildPublicationDependencies = {},
): Promise<BuildPublication> {
  const finalDir = resolve(outputDir);
  if (dryRun) {
    return {
      dryRun: true,
      finalDir,
      buildDir: finalDir,
      publish: () => Promise.resolve(),
      cleanup: () => Promise.resolve(),
    };
  }

  const fs = dependencies.fs ?? createFileSystem();
  const rename = fs.rename?.bind(fs);
  if (!rename) {
    throw publicationError(
      "Atomic build publication requires filesystem rename support",
    );
  }
  const atomicRename = rename;

  const parentDir = dirname(finalDir);
  const outputName = basename(finalDir);
  const id = crypto.randomUUID();
  const buildDir = join(parentDir, `.${outputName}.veryfront-stage-${id}`);
  const backupDir = join(parentDir, `.${outputName}.veryfront-backup-${id}`);
  const lockPath = join(parentDir, `.${outputName}.veryfront-build.lock`);

  await fs.mkdir(parentDir, { recursive: true });
  const releaseLock = await acquireBuildLock(
    lockPath,
    dependencies.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS,
  );

  try {
    await fs.mkdir(buildDir);
  } catch (error) {
    const stageError = publicationError(
      `Failed to create build staging directory: ${buildDir}`,
      error,
    );
    try {
      await releaseLock();
    } catch (releaseError) {
      throw new AggregateError(
        [stageError, releaseError],
        "Build staging setup failed and lock release also failed",
      );
    }
    throw stageError;
  }

  const outputOwnership = Object.freeze(
    Object.create(null),
  ) as BuildOutputOwnership;
  const ownershipRecord: BuildOutputOwnershipRecord = {
    buildDir,
    fileSystem: fs,
    generation: id,
    lifecycle: "live",
  };
  buildOutputOwnershipRecords.set(outputOwnership, ownershipRecord);

  let published = false;
  let cleaned = false;
  let cleanupRequested = false;
  let backupCleanupPending = false;
  let publishInFlight: Promise<void> | undefined;
  let cleanupInFlight: Promise<void> | undefined;

  async function performPublish(): Promise<void> {
    if (!(await fs.exists(buildDir))) {
      throw publicationError(`Build staging directory is missing: ${buildDir}`);
    }

    const hadPreviousOutput = await fs.exists(finalDir);
    if (hadPreviousOutput) {
      try {
        await atomicRename(finalDir, backupDir);
      } catch (error) {
        throw publicationError("Failed to preserve the previous build output", error);
      }
    }

    try {
      await atomicRename(buildDir, finalDir);
      published = true;
    } catch (error) {
      const promotionError = publicationError("Failed to publish staged build output", error);
      if (hadPreviousOutput) {
        try {
          await atomicRename(backupDir, finalDir);
        } catch (rollbackError) {
          throw new AggregateError(
            [
              promotionError,
              publicationError("Failed to restore the previous build output", rollbackError),
            ],
            "Build publication failed and the previous output could not be restored",
          );
        }
      }
      throw promotionError;
    }

    if (!hadPreviousOutput) return;

    backupCleanupPending = true;
    try {
      await fs.remove(backupDir, { recursive: true });
      backupCleanupPending = false;
    } catch (error) {
      logger.warn("Published build but could not remove its backup directory", {
        backupDir,
        error,
      });
    }
  }

  async function performPublicationCleanup(
    pendingPublish: Promise<void> | undefined,
  ): Promise<void> {
    if (pendingPublish) {
      try {
        await pendingPublish;
      } catch {
        // The publish caller owns the primary failure; cleanup still owns all resources.
      }
    }

    const errors: unknown[] = [];

    if (backupCleanupPending) {
      try {
        if (await fs.exists(backupDir)) {
          await fs.remove(backupDir, { recursive: true });
        }
        backupCleanupPending = false;
      } catch (error) {
        errors.push(
          publicationError("Failed to remove published build backup", error),
        );
      }
    }

    if (!published) {
      try {
        if (await fs.exists(buildDir)) {
          await fs.remove(buildDir, { recursive: true });
        }
      } catch (error) {
        errors.push(
          publicationError("Failed to remove abandoned build staging directory", error),
        );
      }
    }

    try {
      await releaseLock();
    } catch (error) {
      errors.push(error);
    }

    if (errors.length === 0) {
      cleaned = true;
      ownershipRecord.lifecycle = "cleaned";
      return;
    }
    if (errors.length === 1) throw errors[0];
    throw new AggregateError(errors, "Failed to clean up build publication resources");
  }

  return {
    dryRun: false,
    finalDir,
    buildDir,
    outputOwnership,
    async publish(): Promise<void> {
      if (published) return;
      if (cleanupRequested) {
        throw publicationError("Cannot publish build output after cleanup has started");
      }
      if (publishInFlight) return await publishInFlight;

      ownershipRecord.lifecycle = "publishing";
      const operation = performPublish();
      publishInFlight = operation;
      try {
        await operation;
        if (ownershipRecord.lifecycle === "publishing") {
          ownershipRecord.lifecycle = "published";
        }
      } finally {
        if (publishInFlight === operation) publishInFlight = undefined;
      }
    },
    async cleanup(): Promise<void> {
      if (cleaned) return;
      cleanupRequested = true;
      ownershipRecord.lifecycle = "cleanup-started";
      if (cleanupInFlight) return await cleanupInFlight;

      const operation = performPublicationCleanup(publishInFlight);
      cleanupInFlight = operation;
      try {
        await operation;
      } finally {
        if (cleanupInFlight === operation) cleanupInFlight = undefined;
      }
    },
  };
}
