import { serverLogger as logger } from "#veryfront/utils";
import { basename, dirname, isAbsolute, join, resolve } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";

/** Immutable paths and mode for one staged output transaction. */
export interface BuildOutputTransaction {
  readonly finalOutputDir: string;
  readonly workingOutputDir: string;
  readonly dryRun: boolean;
}

const activeTransactions = new WeakSet<BuildOutputTransaction>();

function normalizeTransactionOutputDir(outputDir: string): string {
  if (typeof outputDir !== "string" || !outputDir.trim()) {
    throw new TypeError("outputDir must not be blank");
  }
  const normalized = resolve(outputDir);
  if (!isAbsolute(normalized) || dirname(normalized) === normalized) {
    throw new TypeError("outputDir must be an absolute non-root path");
  }
  return normalized;
}

/** Create an active sibling staging transaction for a final output directory. */
export function createBuildOutputTransaction(
  outputDir: string,
  dryRun: boolean,
): BuildOutputTransaction {
  if (typeof dryRun !== "boolean") throw new TypeError("dryRun must be a boolean");
  const finalOutputDir = normalizeTransactionOutputDir(outputDir);
  const transaction: BuildOutputTransaction = Object.freeze({
    finalOutputDir,
    workingOutputDir: dryRun ? finalOutputDir : join(
      dirname(finalOutputDir),
      `.${basename(finalOutputDir)}.${crypto.randomUUID()}.tmp`,
    ),
    dryRun,
  });
  activeTransactions.add(transaction);
  return transaction;
}

function requireActiveTransaction(transaction: BuildOutputTransaction): void {
  if (!activeTransactions.has(transaction)) {
    throw new TypeError("Build output transaction is not active");
  }
}

/** Remove an active transaction's staging directory without changing final output. */
export async function rollbackBuildOutput(transaction: BuildOutputTransaction): Promise<void> {
  requireActiveTransaction(transaction);
  activeTransactions.delete(transaction);
  if (transaction.dryRun) return;

  const fs = createFileSystem();
  try {
    await fs.remove(transaction.workingOutputDir, { recursive: true });
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
}

/** Atomically replace final output with a completed active staging transaction. */
export async function commitBuildOutput(transaction: BuildOutputTransaction): Promise<void> {
  requireActiveTransaction(transaction);
  if (transaction.dryRun) {
    activeTransactions.delete(transaction);
    return;
  }

  const fs = createFileSystem();
  if (!fs.rename) throw new TypeError("Atomic production build commits are not supported");
  const stagingInfo = fs.lstat
    ? await fs.lstat(transaction.workingOutputDir)
    : await fs.stat(transaction.workingOutputDir);
  if (!stagingInfo.isDirectory || stagingInfo.isSymlink) {
    throw new TypeError("Build staging output must be a real directory");
  }

  const backupDir = join(
    dirname(transaction.finalOutputDir),
    `.${basename(transaction.finalOutputDir)}.${crypto.randomUUID()}.backup`,
  );
  let hadPreviousOutput = false;
  try {
    const outputInfo = fs.lstat
      ? await fs.lstat(transaction.finalOutputDir)
      : await fs.stat(transaction.finalOutputDir);
    if (!outputInfo.isDirectory || outputInfo.isSymlink) {
      throw new TypeError("Existing build output must be a real directory");
    }
    hadPreviousOutput = true;
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  if (hadPreviousOutput) await fs.rename(transaction.finalOutputDir, backupDir);
  try {
    await fs.rename(transaction.workingOutputDir, transaction.finalOutputDir);
  } catch (commitError) {
    if (hadPreviousOutput) {
      try {
        await fs.rename(backupDir, transaction.finalOutputDir);
      } catch (restoreError) {
        throw new AggregateError(
          [commitError, restoreError],
          "Build output commit and previous-output restoration both failed",
        );
      }
    }
    throw commitError;
  }

  if (hadPreviousOutput) {
    try {
      await fs.remove(backupDir, { recursive: true });
    } catch (cleanupError) {
      try {
        await fs.remove(transaction.finalOutputDir, { recursive: true });
        await fs.rename(backupDir, transaction.finalOutputDir);
      } catch (restoreError) {
        throw new AggregateError(
          [cleanupError, restoreError],
          "Build backup cleanup and previous-output restoration both failed",
        );
      }
      throw cleanupError;
    }
  }
  activeTransactions.delete(transaction);
}

/** Reset and create the standard working output directories. */
export async function setupBuildDirectories(
  adapter: RuntimeAdapter,
  outputDir: string,
  dryRun: boolean,
): Promise<void> {
  const normalizedOutputDir = normalizeTransactionOutputDir(outputDir);
  if (typeof dryRun !== "boolean") throw new TypeError("dryRun must be a boolean");
  logger.info("Setting up build directories...");

  if (dryRun) {
    logger.info("Build directories ready");
    return;
  }

  try {
    await adapter.fs.remove(normalizedOutputDir, { recursive: true });
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  const dirs = [
    normalizedOutputDir,
    join(normalizedOutputDir, "_veryfront"),
    join(normalizedOutputDir, "_veryfront/chunks"),
    join(normalizedOutputDir, "_veryfront/data"),
    join(normalizedOutputDir, "assets"),
  ];

  for (const dir of dirs) {
    try {
      await adapter.fs.mkdir(dir, { recursive: true });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? (error as { code?: string }).code
        : undefined;

      if (code !== "EEXIST") throw error;
    }
  }

  logger.info("Build directories ready");
}
