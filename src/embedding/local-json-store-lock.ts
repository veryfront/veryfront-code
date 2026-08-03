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
const LOCK_MAX_ENTRIES = 1_024;
const UUID_V4_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const LOCK_TOKEN_PATTERN = new RegExp(`^${UUID_V4_PATTERN}$`, "i");
const LOCK_OWNER_MARKER_PATTERN = new RegExp(
  `^\\.owner\\.(?:recovering|releasing)\\.${UUID_V4_PATTERN}$`,
  "i",
);
const LOCK_LEASE_FILE_PATTERN = new RegExp(`^(${UUID_V4_PATTERN})\\.lease$`, "i");
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
  readonly entryFileNames: readonly string[];
  readonly leases: readonly LeaseObservation[];
  readonly temporaryFileNames: readonly string[];
  readonly newestLeaseMtimeMs: number | null;
}

interface LeaseObservation {
  readonly fileName: string;
  readonly token: string;
  readonly mtimeMs: number | null;
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

  const entryFileNames: string[] = [];
  const seenEntryNames = new Set<string>();
  for await (const entry of fs.readDir(lockDirectory)) {
    if (entryFileNames.length >= LOCK_MAX_ENTRIES) {
      throw new LocalJsonStoreLockError("The RAG store lock contains too many entries");
    }
    if (seenEntryNames.has(entry.name)) {
      throw new LocalJsonStoreLockError("The RAG store lock contains duplicate entries");
    }
    seenEntryNames.add(entry.name);
    entryFileNames.push(entry.name);
  }
  entryFileNames.sort();

  const ownerMarkers = entryFileNames.filter((name) => LOCK_OWNER_MARKER_PATTERN.test(name));
  const hasCanonicalOwner = seenEntryNames.has(OWNER_FILE_NAME);
  if (ownerMarkers.length > 1 || (hasCanonicalOwner && ownerMarkers.length > 0)) {
    throw new LocalJsonStoreLockError(
      "The RAG store lock contains ambiguous ownership metadata",
    );
  }
  const ownerFileName = hasCanonicalOwner ? OWNER_FILE_NAME : ownerMarkers[0] ?? null;
  const leases: LeaseObservation[] = [];
  const temporaryFileNames: string[] = [];

  for (const entryName of entryFileNames) {
    const isOwner = entryName === ownerFileName;
    const leaseMatch = LOCK_LEASE_FILE_PATTERN.exec(entryName);
    const isTemporary = LOCK_TEMPORARY_FILE_PATTERN.test(entryName);
    if (!isOwner && leaseMatch === null && !isTemporary) {
      throw new LocalJsonStoreLockError("The RAG store lock contains an unexpected entry");
    }

    let entryInfo;
    try {
      entryInfo = await lstat(join(lockDirectory, entryName));
    } catch (error) {
      if (isCanonicalNotFoundError(error)) {
        throw new LocalJsonStoreLockError(
          "RAG store lock contents changed while they were being inspected",
          { cause: error },
        );
      }
      throw error;
    }
    if (!entryInfo.isFile || entryInfo.isSymlink) {
      throw new LocalJsonStoreLockError("The RAG store lock entry is not a real file");
    }
    if (leaseMatch !== null) {
      leases.push({
        fileName: entryName,
        token: leaseMatch[1]!.toLowerCase(),
        mtimeMs: entryInfo.mtime?.getTime() ?? null,
      });
    } else if (isTemporary) {
      temporaryFileNames.push(entryName);
    }
  }

  let ownerText: string | null = null;
  if (ownerFileName !== null) {
    ownerText = await readBoundedText(fs, join(lockDirectory, ownerFileName));
    if (ownerText === null) {
      throw new LocalJsonStoreLockError(
        "RAG store lock ownership changed while it was being inspected",
      );
    }
  }
  const owner = ownerText === null ? null : parseOwner(ownerText);
  const newestLeaseMtimeMs = leases.length === 0 || leases.some((lease) => lease.mtimeMs === null)
    ? null
    : Math.max(...leases.map((lease) => lease.mtimeMs!));

  return {
    directoryMtimeMs: directoryInfo.mtime?.getTime() ?? null,
    owner,
    ownerFileName,
    ownerText,
    entryFileNames,
    leases,
    temporaryFileNames,
    newestLeaseMtimeMs,
  };
}

function isStale(observation: LockObservation, nowMs: number): boolean {
  if (observation.leases.length > 0) {
    // Every lease participates in staleness. One unavailable timestamp makes
    // the entire generation unsafe to fence, and the newest known lease is
    // authoritative even when ownership metadata points at another token.
    return observation.newestLeaseMtimeMs !== null &&
      observation.newestLeaseMtimeMs <= nowMs - LOCK_STALE_AFTER_MS;
  }
  const lastKnownActivityMs = observation.owner?.createdAtMs ?? observation.directoryMtimeMs;
  // A missing lease falls back to immutable owner creation time. Ownerless
  // partial acquisitions may use directory time, but missing metadata fails closed.
  return lastKnownActivityMs !== null && lastKnownActivityMs <= nowMs - LOCK_STALE_AFTER_MS;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameLeases(
  left: readonly LeaseObservation[],
  right: readonly LeaseObservation[],
): boolean {
  return left.length === right.length && left.every((lease, index) => {
    const candidate = right[index];
    return candidate !== undefined &&
      lease.fileName === candidate.fileName &&
      lease.token === candidate.token &&
      lease.mtimeMs === candidate.mtimeMs;
  });
}

function sameGeneration(left: LockObservation, right: LockObservation): boolean {
  return left.directoryMtimeMs === right.directoryMtimeMs &&
    left.ownerFileName === right.ownerFileName &&
    left.ownerText === right.ownerText &&
    left.owner?.token === right.owner?.token &&
    sameStringArray(left.entryFileNames, right.entryFileNames) &&
    sameLeases(left.leases, right.leases);
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
  if (
    knownTemporaryNames !== undefined &&
    observation.temporaryFileNames.some((name) => !knownTemporaryNames.has(name))
  ) {
    throw new LocalJsonStoreLockError(
      "RAG store lock contains a temporary file not owned by this operation",
    );
  }
  const ownerMarkerName = await claimObservedOwner(fs, lockDirectory, observation, phase);

  const claimed = await readObservation(fs, lockDirectory);
  if (claimed === null) {
    throw new LocalJsonStoreLockError("RAG store lock disappeared during cleanup");
  }
  const expectedEntryNames = observation.entryFileNames.map((name) =>
    name === observation.ownerFileName && ownerMarkerName !== null ? ownerMarkerName : name
  ).sort();
  if (
    claimed.ownerFileName !== ownerMarkerName ||
    claimed.ownerText !== observation.ownerText ||
    claimed.owner?.token !== observation.owner?.token ||
    !sameStringArray(claimed.entryFileNames, expectedEntryNames) ||
    !sameLeases(claimed.leases, observation.leases)
  ) {
    throw new LocalJsonStoreLockError(
      "RAG store lock generation changed before cleanup completed",
    );
  }

  for (const name of claimed.entryFileNames) {
    if (
      name !== ownerMarkerName &&
      !claimed.leases.some((lease) => lease.fileName === name) &&
      !claimed.temporaryFileNames.includes(name)
    ) {
      throw new LocalJsonStoreLockError(
        "RAG store lock contains an entry outside the fenced generation",
      );
    }
  }

  for (const name of claimed.entryFileNames) {
    if (name !== ownerMarkerName) await fs.remove(join(lockDirectory, name));
  }
  if (ownerMarkerName !== null) {
    await fs.remove(join(lockDirectory, ownerMarkerName));
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
  if (current === null || !sameGeneration(observed, current) || !isStale(current, Date.now())) {
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
  if (
    !sameGeneration(observed, moved) ||
    !sameGeneration(current, moved) ||
    !isStale(moved, Date.now())
  ) {
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
  const expectedLeaseName = `${token}.lease`;
  if (
    observed?.ownerFileName !== OWNER_FILE_NAME ||
    observed.owner?.token !== token ||
    observed.ownerText !== ownerText ||
    observed.leases.length !== 1 ||
    observed.leases[0]?.fileName !== expectedLeaseName ||
    observed.temporaryFileNames.some((name) => name !== temporaryName)
  ) {
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
    if (
      observation?.ownerFileName !== OWNER_FILE_NAME ||
      observation.owner?.token !== token ||
      observation.ownerText !== ownerText ||
      observation.leases.length !== 1 ||
      observation.leases[0]?.fileName !== `${token}.lease` ||
      observation.temporaryFileNames.some((name) => name !== temporaryName)
    ) {
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
