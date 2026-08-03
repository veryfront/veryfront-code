import {
  createFileSystem,
  type FileSystem,
  isAlreadyExistsError,
} from "#veryfront/platform/compat/fs.ts";
import { isCanonicalNotFoundError } from "#veryfront/platform/compat/not-found-error.ts";
import { dirname, join } from "#veryfront/platform/compat/path/basic-operations.ts";
import { resolve } from "#veryfront/platform/compat/path/resolution.ts";
import { serverLogger } from "#veryfront/utils";

const LOCK_ACQUIRE_TIMEOUT_MS = 10_000;
// A live owner renews every five seconds. Twelve missed renewals are required
// before another process may fence it and recover the lock.
const LOCK_STALE_AFTER_MS = 60_000;
const LOCK_HEARTBEAT_INTERVAL_MS = 5_000;
const LOCK_RETRY_INITIAL_MS = 10;
const LOCK_RETRY_MAX_MS = 100;
const LOCK_METADATA_MAX_BYTES = 4_096;
const UUID_V4_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const LOCK_TOKEN_PATTERN = new RegExp(`^${UUID_V4_PATTERN}$`, "i");
const LOCK_OWNER_MARKER_PATTERN = new RegExp(
  `^\\.owner\\.(?:recovering|releasing)\\.${UUID_V4_PATTERN}$`,
  "i",
);
const LOCK_TEMPORARY_FILE_PATTERN = new RegExp(`^\\.tmp\\.${UUID_V4_PATTERN}$`, "i");
const OWNER_FILE_NAME = "owner.json";

const processLocks = new Map<string, Promise<void>>();
const logger = serverLogger.component("rag-store-lock");

interface LockOwner {
  readonly token: string;
  readonly createdAtMs: number;
}

interface LockObservation {
  readonly directoryMtimeMs: number | null;
  readonly owner: LockOwner | null;
  readonly ownerFileName: string | null;
  readonly ownerText: string | null;
  readonly leaseFileNames: readonly string[];
  readonly leasePresent: boolean;
  readonly leaseMtimeMs: number | null;
}

export interface LocalJsonStoreLease {
  readonly temporaryPath: string;
  assertOwned(): Promise<void>;
}

export class LocalJsonStoreLockError extends Error {
  override readonly name = "LocalJsonStoreLockError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, durationMs));
}

function withProcessLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previous = processLocks.get(path) ?? Promise.resolve();
  const result = previous.then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  processLocks.set(path, tail);
  void tail.finally(() => {
    if (processLocks.get(path) === tail) processLocks.delete(path);
  });
  return result;
}

function parseOwner(text: string): LockOwner | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.token !== "string" || !LOCK_TOKEN_PATTERN.test(record.token) ||
      typeof record.createdAtMs !== "number" || !Number.isSafeInteger(record.createdAtMs) ||
      record.createdAtMs < 0
    ) {
      return null;
    }
    return { token: record.token, createdAtMs: record.createdAtMs };
  } catch {
    return null;
  }
}

async function readBoundedText(fs: FileSystem, path: string): Promise<string | null> {
  const readWithinLimit = fs.readFileBytesWithinLimit?.bind(fs);
  if (!readWithinLimit) {
    throw new LocalJsonStoreLockError(
      "The native filesystem cannot safely read RAG store lock metadata",
    );
  }
  try {
    const bytes = await readWithinLimit(path, LOCK_METADATA_MAX_BYTES);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (isCanonicalNotFoundError(error)) return null;
    if (error instanceof RangeError || error instanceof TypeError) return "";
    throw error;
  }
}

async function readDirectoryEntryNames(
  fs: FileSystem,
  lockDirectory: string,
): Promise<string[] | null> {
  const entryNames: string[] = [];
  try {
    for await (const entry of fs.readDir(lockDirectory)) {
      entryNames.push(entry.name);
    }
  } catch (error) {
    if (isCanonicalNotFoundError(error)) return null;
    throw error;
  }
  return entryNames;
}

async function readObservation(
  fs: FileSystem,
  lockDirectory: string,
): Promise<LockObservation | null> {
  const lstat = fs.lstat?.bind(fs);
  if (!lstat) {
    throw new LocalJsonStoreLockError(
      "The native filesystem cannot safely inspect the RAG store lock",
    );
  }

  let directoryInfo;
  try {
    directoryInfo = await lstat(lockDirectory);
  } catch (error) {
    if (isCanonicalNotFoundError(error)) return null;
    throw error;
  }
  if (!directoryInfo.isDirectory || directoryInfo.isSymlink) {
    throw new LocalJsonStoreLockError("The RAG store lock path is not a real directory");
  }

  let directoryEntryNames: string[] | null = null;
  let ownerFileName: string | null = OWNER_FILE_NAME;
  let ownerText = await readBoundedText(fs, join(lockDirectory, OWNER_FILE_NAME));
  if (ownerText === null) {
    directoryEntryNames = await readDirectoryEntryNames(fs, lockDirectory);
    if (directoryEntryNames === null) return null;
    const ownerMarkers: string[] = [];
    for (const entryName of directoryEntryNames) {
      if (LOCK_OWNER_MARKER_PATTERN.test(entryName)) ownerMarkers.push(entryName);
    }
    if (ownerMarkers.length > 1) {
      throw new LocalJsonStoreLockError(
        "The RAG store lock contains multiple ownership cleanup markers",
      );
    }
    ownerFileName = ownerMarkers[0] ?? null;
    if (ownerFileName !== null) {
      ownerText = await readBoundedText(fs, join(lockDirectory, ownerFileName));
    }
  }
  const owner = ownerText === null ? null : parseOwner(ownerText);
  const leaseFileNames: string[] = [];
  let leaseMtimeMs: number | null = null;
  if (owner !== null) {
    const leaseFileName = `${owner.token}.lease`;
    try {
      const leaseInfo = await lstat(join(lockDirectory, leaseFileName));
      if (!leaseInfo.isFile || leaseInfo.isSymlink) {
        throw new LocalJsonStoreLockError("The RAG store lock lease is not a real file");
      }
      leaseFileNames.push(leaseFileName);
      leaseMtimeMs = leaseInfo.mtime?.getTime() ?? null;
    } catch (error) {
      if (!isCanonicalNotFoundError(error)) throw error;
    }
  } else {
    // Ownership metadata may be malformed, oversized, or undecodable while a
    // live owner is still renewing its token-specific lease. Discover leases
    // independently so ambiguous ownership can never make a live lock appear
    // ownerless and stale merely because the directory mtime is old.
    if (directoryEntryNames === null) {
      directoryEntryNames = await readDirectoryEntryNames(fs, lockDirectory);
      if (directoryEntryNames === null) return null;
    }
    let newestLeaseMtimeMs: number | null = null;
    for (const entryName of directoryEntryNames) {
      if (!entryName.endsWith(".lease")) continue;
      let leaseInfo;
      try {
        leaseInfo = await lstat(join(lockDirectory, entryName));
      } catch (error) {
        if (isCanonicalNotFoundError(error)) {
          throw new LocalJsonStoreLockError(
            "RAG store lock lease changed while ownership was being inspected",
            { cause: error },
          );
        }
        throw error;
      }
      if (!leaseInfo.isFile || leaseInfo.isSymlink) {
        throw new LocalJsonStoreLockError("The RAG store lock lease is not a real file");
      }
      leaseFileNames.push(entryName);
      const mtimeMs = leaseInfo.mtime?.getTime() ?? null;
      if (mtimeMs === null) {
        newestLeaseMtimeMs = null;
        break;
      }
      newestLeaseMtimeMs = newestLeaseMtimeMs === null
        ? mtimeMs
        : Math.max(newestLeaseMtimeMs, mtimeMs);
    }
    leaseMtimeMs = newestLeaseMtimeMs;
  }

  return {
    directoryMtimeMs: directoryInfo.mtime?.getTime() ?? null,
    owner,
    ownerFileName,
    ownerText,
    leaseFileNames,
    leasePresent: leaseFileNames.length > 0,
    leaseMtimeMs,
  };
}

function isStale(observation: LockObservation, nowMs: number): boolean {
  if (observation.leasePresent) {
    // A present lease with unavailable time metadata cannot be safely fenced.
    return observation.leaseMtimeMs !== null &&
      observation.leaseMtimeMs <= nowMs - LOCK_STALE_AFTER_MS;
  }
  const lastKnownActivityMs = observation.owner?.createdAtMs ?? observation.directoryMtimeMs;
  // A missing lease falls back to immutable owner creation time. Ownerless
  // partial acquisitions may use directory time, but missing metadata fails closed.
  return lastKnownActivityMs !== null && lastKnownActivityMs <= nowMs - LOCK_STALE_AFTER_MS;
}

function sameOwner(left: LockObservation, right: LockObservation): boolean {
  return left.ownerText === right.ownerText && left.owner?.token === right.owner?.token;
}

async function removeIfPresent(fs: FileSystem, path: string): Promise<void> {
  try {
    await fs.remove(path);
  } catch (error) {
    if (!isCanonicalNotFoundError(error)) throw error;
  }
}

type CleanupPhase = "recovering" | "releasing";

async function claimObservedOwner(
  fs: FileSystem,
  lockDirectory: string,
  observation: LockObservation,
  phase: CleanupPhase,
): Promise<string | null> {
  if (observation.ownerFileName === null || observation.ownerText === null) return null;
  if (observation.ownerFileName !== OWNER_FILE_NAME) return observation.ownerFileName;

  const rename = fs.rename?.bind(fs);
  if (!rename) {
    throw new LocalJsonStoreLockError(
      "The native filesystem cannot claim RAG store lock ownership for cleanup",
    );
  }
  const markerName = `.owner.${phase}.${crypto.randomUUID()}`;
  const markerPath = join(lockDirectory, markerName);
  try {
    await rename(join(lockDirectory, OWNER_FILE_NAME), markerPath);
  } catch (error) {
    throw new LocalJsonStoreLockError(
      "RAG store lock ownership changed before cleanup could be claimed",
      { cause: error },
    );
  }
  if (await readBoundedText(fs, markerPath) !== observation.ownerText) {
    throw new LocalJsonStoreLockError(
      "RAG store lock ownership changed while cleanup was being claimed",
    );
  }
  return markerName;
}

/**
 * Remove only files belonging to one observed lock generation, then remove the
 * directory non-recursively. A replacement generation retains owner.json and
 * its token-specific lease, so it cannot be erased in a check-to-delete race.
 */
async function removeObservedLockGeneration(
  fs: FileSystem,
  lockDirectory: string,
  observation: LockObservation,
  phase: CleanupPhase,
  knownTemporaryNames?: ReadonlySet<string>,
): Promise<void> {
  const ownerMarkerName = await claimObservedOwner(fs, lockDirectory, observation, phase);
  const leaseNames = new Set(observation.leaseFileNames);
  const removableNames: string[] = [];
  for await (const entry of fs.readDir(lockDirectory)) {
    const isObservedOwner = entry.name === ownerMarkerName;
    const isObservedLease = leaseNames.has(entry.name);
    const isOwnedTemporary = LOCK_TEMPORARY_FILE_PATTERN.test(entry.name) &&
      (knownTemporaryNames === undefined || knownTemporaryNames.has(entry.name));
    if (!isObservedOwner && !isObservedLease && !isOwnedTemporary) {
      throw new LocalJsonStoreLockError(
        "RAG store lock contents changed before cleanup completed",
      );
    }
    removableNames.push(entry.name);
  }

  for (const name of removableNames) {
    if (name !== ownerMarkerName) await removeIfPresent(fs, join(lockDirectory, name));
  }
  if (ownerMarkerName !== null) {
    await removeIfPresent(fs, join(lockDirectory, ownerMarkerName));
  }
  try {
    await fs.remove(lockDirectory);
  } catch (error) {
    if (isCanonicalNotFoundError(error)) return;
    throw new LocalJsonStoreLockError(
      "RAG store lock contents changed before the directory could be removed",
      { cause: error },
    );
  }
}

async function clearInterruptedTransition(
  fs: FileSystem,
  transitionDirectory: string,
  nowMs: number,
): Promise<boolean> {
  const observation = await readObservation(fs, transitionDirectory);
  if (observation === null) return true;
  if (!isStale(observation, nowMs)) return false;
  await removeObservedLockGeneration(
    fs,
    transitionDirectory,
    observation,
    "recovering",
  );
  return true;
}

async function restoreUnexpectedRecovery(
  fs: FileSystem,
  lockDirectory: string,
  recoveryDirectory: string,
): Promise<void> {
  if (await fs.exists(lockDirectory)) {
    throw new LocalJsonStoreLockError(
      "RAG store lock ownership changed during stale-lock recovery",
    );
  }
  const rename = fs.rename?.bind(fs);
  if (!rename) {
    throw new LocalJsonStoreLockError(
      "The native filesystem cannot restore RAG store lock ownership",
    );
  }
  await rename(recoveryDirectory, lockDirectory);
}

/**
 * Move a stale lock through one deterministic recovery directory before
 * deleting it. The post-rename owner check restores a newer generation if
 * ownership changed in the observation-to-rename window. Recovery never
 * writes inside the observed directory, because doing so would refresh the
 * only safe fallback timestamp for an ownerless partial acquisition.
 */
async function tryRecoverStaleLock(
  fs: FileSystem,
  lockDirectory: string,
  recoveryDirectory: string,
  observed: LockObservation,
): Promise<boolean> {
  const rename = fs.rename?.bind(fs);
  if (!rename) {
    throw new LocalJsonStoreLockError(
      "The native filesystem cannot recover a stale RAG store lock",
    );
  }

  const current = await readObservation(fs, lockDirectory);
  if (current === null || !sameOwner(observed, current) || !isStale(current, Date.now())) {
    return false;
  }

  try {
    await rename(lockDirectory, recoveryDirectory);
  } catch (error) {
    if (isCanonicalNotFoundError(error) || isAlreadyExistsError(error)) return false;
    throw error;
  }

  const moved = await readObservation(fs, recoveryDirectory);
  if (moved === null) return false;
  if (!sameOwner(observed, moved) || !isStale(moved, Date.now())) {
    await restoreUnexpectedRecovery(fs, lockDirectory, recoveryDirectory);
    return false;
  }
  await removeObservedLockGeneration(fs, recoveryDirectory, moved, "recovering");
  return true;
}

async function releaseOwnedLock(
  fs: FileSystem,
  lockDirectory: string,
  ownerText: string,
  token: string,
  temporaryName: string,
): Promise<void> {
  const observed = await readObservation(fs, lockDirectory);
  if (observed?.owner?.token !== token || observed.ownerText !== ownerText) {
    throw new LocalJsonStoreLockError("RAG store lock ownership changed during release");
  }
  await removeObservedLockGeneration(
    fs,
    lockDirectory,
    observed,
    "releasing",
    new Set([temporaryName]),
  );
}

async function acquireNativeLock(
  fs: FileSystem,
  storagePath: string,
): Promise<{
  lease: LocalJsonStoreLease;
  release(): Promise<void>;
}> {
  const lockDirectory = `${storagePath}.veryfront-rag.lock`;
  const recoveryDirectory = `${lockDirectory}.recovering`;
  const ownerPath = join(lockDirectory, OWNER_FILE_NAME);
  const token = crypto.randomUUID();
  const leasePath = join(lockDirectory, `${token}.lease`);
  // Publication temps live inside the owned directory. Stale-lock recovery
  // atomically moves this directory before deleting it, so a fenced writer
  // cannot publish through a check-to-rename scheduling gap.
  const temporaryName = `.tmp.${crypto.randomUUID()}`;
  const temporaryPath = join(lockDirectory, temporaryName);
  const ownerText = `${JSON.stringify({ token, createdAtMs: Date.now() })}\n`;
  const startedAtMs = Date.now();
  let retryDelayMs = LOCK_RETRY_INITIAL_MS;

  await fs.mkdir(dirname(storagePath), { recursive: true });

  while (true) {
    const nowMs = Date.now();
    if (await clearInterruptedTransition(fs, recoveryDirectory, nowMs)) {
      try {
        await fs.mkdir(lockDirectory);
        try {
          await fs.writeTextFile(ownerPath, ownerText);
          await fs.writeTextFile(leasePath, `${nowMs}\n`);
          break;
        } catch (error) {
          const incomplete = await readObservation(fs, lockDirectory).catch(() => null);
          if (incomplete?.owner?.token === token && incomplete.ownerText === ownerText) {
            await releaseOwnedLock(
              fs,
              lockDirectory,
              ownerText,
              token,
              temporaryName,
            ).catch(() => undefined);
          }
          throw error;
        }
      } catch (error) {
        if (!isAlreadyExistsError(error)) throw error;
        const observation = await readObservation(fs, lockDirectory);
        if (
          observation !== null && isStale(observation, nowMs) &&
          await tryRecoverStaleLock(fs, lockDirectory, recoveryDirectory, observation)
        ) {
          retryDelayMs = LOCK_RETRY_INITIAL_MS;
          continue;
        }
      }
    }

    if (nowMs - startedAtMs >= LOCK_ACQUIRE_TIMEOUT_MS) {
      throw new LocalJsonStoreLockError(
        "Timed out waiting for another RAG store operation to release its lock",
      );
    }
    await sleep(retryDelayMs);
    retryDelayMs = Math.min(retryDelayMs * 2, LOCK_RETRY_MAX_MS);
  }

  let released = false;
  let heartbeatError: unknown;
  let heartbeatTail = Promise.resolve();

  const assertOwned = async (): Promise<void> => {
    if (released) throw new LocalJsonStoreLockError("The RAG store lock was already released");
    if (heartbeatError !== undefined) {
      throw new LocalJsonStoreLockError("The RAG store lock heartbeat failed", {
        cause: heartbeatError,
      });
    }
    const observation = await readObservation(fs, lockDirectory);
    if (observation?.owner?.token !== token || observation.ownerText !== ownerText) {
      throw new LocalJsonStoreLockError("RAG store lock ownership was lost");
    }
  };

  const heartbeat = (): void => {
    heartbeatTail = heartbeatTail.then(async () => {
      if (released || heartbeatError !== undefined) return;
      await assertOwned();
      await fs.writeTextFile(leasePath, `${Date.now()}\n`);
    }).catch((error) => {
      heartbeatError = error;
    });
  };
  const heartbeatId = setInterval(heartbeat, LOCK_HEARTBEAT_INTERVAL_MS);

  return {
    lease: { assertOwned, temporaryPath },
    async release(): Promise<void> {
      if (released) return;
      clearInterval(heartbeatId);
      await heartbeatTail;
      await assertOwned();
      await releaseOwnedLock(fs, lockDirectory, ownerText, token, temporaryName);
      released = true;
    },
  };
}

/**
 * Serialize one local JSON store operation across instances and cooperating
 * processes. The in-process queue prevents needless native contention; the
 * adjacent lease directory is the actual cross-process ownership boundary.
 */
export async function withLocalJsonStoreLock<T>(
  storagePath: string,
  operation: (lease: LocalJsonStoreLease) => Promise<T>,
): Promise<T> {
  const canonicalPath = resolve(storagePath);
  return await withProcessLock(canonicalPath, async () => {
    const fs = createFileSystem();
    const acquired = await acquireNativeLock(fs, canonicalPath);
    try {
      const result = await operation(acquired.lease);
      try {
        await acquired.release();
      } catch (error) {
        logger.error("A completed RAG store operation could not release its lock", { error });
      }
      return result;
    } catch (operationError) {
      try {
        await acquired.release();
      } catch (releaseError) {
        logger.error("A failed RAG store operation also could not release its lock", {
          operationError,
          releaseError,
        });
      }
      throw operationError;
    }
  });
}
