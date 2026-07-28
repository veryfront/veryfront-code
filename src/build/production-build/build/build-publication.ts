import { basename, dirname, join, resolve } from "#veryfront/compat/path/index.ts";
import { createFileSystem, type FileSystem } from "#veryfront/platform/compat/fs.ts";
import { BUILD_FAILED } from "#veryfront/errors";
import { serverLogger } from "#veryfront/utils";

const logger = serverLogger.component("build-publication");
const DEFAULT_LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_INITIAL_MS = 10;
const LOCK_RETRY_MAX_MS = 100;

export interface BuildPublication {
  readonly finalDir: string;
  readonly buildDir: string;
  publish(): Promise<void>;
  cleanup(): Promise<void>;
}

export interface BuildPublicationDependencies {
  fs?: FileSystem;
  lockTimeoutMs?: number;
}

function publicationError(detail: string, cause?: unknown): Error {
  return BUILD_FAILED.create({ detail, cause });
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
      await handle?.close().catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        if (ownsLock) {
          await nodeFs.rm(lockPath, { force: true }).catch(() => undefined);
        }
        throw publicationError(`Failed to acquire build output lock: ${lockPath}`, error);
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
  return async (): Promise<void> => {
    if (released) return;
    const current = await nodeFs.readFile(lockPath, "utf8").catch((error) => {
      throw publicationError(`Failed to verify build output lock: ${lockPath}`, error);
    });
    if (current !== content) {
      throw publicationError(`Build output lock ownership changed unexpectedly: ${lockPath}`);
    }
    await nodeFs.rm(lockPath);
    released = true;
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

  let published = false;
  let cleaned = false;

  return {
    finalDir,
    buildDir,
    async publish(): Promise<void> {
      if (published) return;
      if (!(await fs.exists(buildDir))) {
        throw publicationError(`Build staging directory is missing: ${buildDir}`);
      }

      const hadPreviousOutput = await fs.exists(finalDir);
      if (hadPreviousOutput) await rename(finalDir, backupDir);

      try {
        await rename(buildDir, finalDir);
        published = true;
      } catch (error) {
        if (hadPreviousOutput) {
          try {
            await rename(backupDir, finalDir);
          } catch (rollbackError) {
            throw new AggregateError(
              [error, rollbackError],
              "Build publication failed and the previous output could not be restored",
            );
          }
        }
        throw publicationError("Failed to publish staged build output", error);
      }

      if (hadPreviousOutput) {
        try {
          await fs.remove(backupDir, { recursive: true });
        } catch (error) {
          logger.warn("Published build but could not remove its backup directory", {
            backupDir,
            error,
          });
        }
      }
    },
    async cleanup(): Promise<void> {
      if (cleaned) return;
      const errors: unknown[] = [];

      if (!published && await fs.exists(buildDir)) {
        try {
          await fs.remove(buildDir, { recursive: true });
        } catch (error) {
          errors.push(error);
        }
      }

      try {
        await releaseLock();
      } catch (error) {
        errors.push(error);
      }

      if (errors.length === 0) {
        cleaned = true;
        return;
      }
      if (errors.length === 1) throw errors[0];
      throw new AggregateError(errors, "Failed to clean up build publication resources");
    },
  };
}
