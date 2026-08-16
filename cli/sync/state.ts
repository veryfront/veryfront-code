import { isNotFoundError, lstat, realPath } from "veryfront/fs";
import { join, relative } from "veryfront/platform/path";
import { normalizeControlPlane } from "../shared/deployment-provenance.ts";

const SYNC_STATE_VERSION = 1 as const;
const SYNC_STATE_DIRECTORY = ".veryfront";
const SYNC_STATE_FILENAME = "sync-state.json";
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

export const SYNC_STATE_RELATIVE_PATH = `${SYNC_STATE_DIRECTORY}/${SYNC_STATE_FILENAME}`;

export interface SyncFileSnapshot {
  digest: string;
  versionId?: string;
}

export interface SyncTargetScope {
  controlPlane: string;
  projectId: string;
  branch: string;
}

export interface SyncTarget extends SyncTargetScope {
  projectSlug: string;
  files: Record<string, SyncFileSnapshot>;
}

interface SyncState {
  version: typeof SYNC_STATE_VERSION;
  targets: SyncTarget[];
}

interface SyncStatePath {
  directoryExists: boolean;
  fileExists: boolean;
}

const encoder = new TextEncoder();

export async function computeContentDigest(content: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(content));
  return `sha256:${
    Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  }`;
}

function syncStatePath(projectDir: string): string {
  return join(projectDir, SYNC_STATE_DIRECTORY, SYNC_STATE_FILENAME);
}

function syncStatePathError(): Error {
  return new Error(
    `Veryfront cannot use ${SYNC_STATE_RELATIVE_PATH} through a symbolic link. Remove the link and run the command again.`,
  );
}

function invalidSyncStateError(): Error {
  return new Error(
    `Veryfront could not read ${SYNC_STATE_RELATIVE_PATH}; remove it, run veryfront pull, and try again.`,
  );
}

async function lstatIfPresent(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function inspectSyncStatePath(projectDir: string): Promise<SyncStatePath> {
  const directory = join(projectDir, SYNC_STATE_DIRECTORY);
  const directoryInfo = await lstatIfPresent(directory);
  if (!directoryInfo) return { directoryExists: false, fileExists: false };
  if (directoryInfo.isSymlink) throw syncStatePathError();
  if (!directoryInfo.isDirectory) {
    throw new Error(`${SYNC_STATE_DIRECTORY} must be a directory inside the project.`);
  }

  const [canonicalProject, canonicalDirectory] = await Promise.all([
    realPath(projectDir),
    realPath(directory),
  ]);
  if (relative(canonicalProject, canonicalDirectory) !== SYNC_STATE_DIRECTORY) {
    throw syncStatePathError();
  }

  const fileInfo = await lstatIfPresent(syncStatePath(projectDir));
  if (!fileInfo) return { directoryExists: true, fileExists: false };
  if (fileInfo.isSymlink) throw syncStatePathError();
  if (!fileInfo.isFile) {
    throw new Error(`${SYNC_STATE_RELATIVE_PATH} must be a file.`);
  }
  return { directoryExists: true, fileExists: true };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSyncFileSnapshot(value: unknown): value is SyncFileSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  return typeof snapshot.digest === "string" && DIGEST_PATTERN.test(snapshot.digest) &&
    (snapshot.versionId === undefined || isNonEmptyString(snapshot.versionId));
}

function isSyncTarget(value: unknown): value is SyncTarget {
  if (!value || typeof value !== "object") return false;
  const target = value as Record<string, unknown>;
  if (
    !isNonEmptyString(target.controlPlane) ||
    !isNonEmptyString(target.projectId) ||
    !isNonEmptyString(target.projectSlug) ||
    !isNonEmptyString(target.branch) ||
    !target.files ||
    typeof target.files !== "object" ||
    Array.isArray(target.files)
  ) {
    return false;
  }
  try {
    normalizeControlPlane(target.controlPlane);
  } catch {
    return false;
  }
  return Object.entries(target.files).every(([path, snapshot]) =>
    path.length > 0 && isSyncFileSnapshot(snapshot)
  );
}

function isSyncState(value: unknown): value is SyncState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return state.version === SYNC_STATE_VERSION && Array.isArray(state.targets) &&
    state.targets.every(isSyncTarget);
}

function normalizeScope<T extends SyncTargetScope>(scope: T): T {
  return { ...scope, controlPlane: normalizeControlPlane(scope.controlPlane) };
}

function targetMatchesScope(target: SyncTarget, scope: SyncTargetScope): boolean {
  return normalizeControlPlane(target.controlPlane) === scope.controlPlane &&
    target.projectId === scope.projectId && target.branch === scope.branch;
}

function sortedFiles(
  files: Readonly<Record<string, SyncFileSnapshot>>,
): Record<string, SyncFileSnapshot> {
  return Object.fromEntries(
    Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, snapshot]) => [path, { ...snapshot }]),
  );
}

function targetSortKey(target: SyncTarget): string {
  return `${target.controlPlane}\0${target.projectId}\0${target.branch}`;
}

async function readSyncState(projectDir: string): Promise<SyncState> {
  const inspected = await inspectSyncStatePath(projectDir);
  if (!inspected.fileExists) return { version: SYNC_STATE_VERSION, targets: [] };
  try {
    const parsed: unknown = JSON.parse(await Deno.readTextFile(syncStatePath(projectDir)));
    if (isSyncState(parsed)) return parsed;
  } catch {
    throw invalidSyncStateError();
  }
  throw invalidSyncStateError();
}

export async function readSyncTarget(
  projectDir: string,
  inputScope: SyncTargetScope,
): Promise<SyncTarget | null> {
  const scope = normalizeScope(inputScope);
  const state = await readSyncState(projectDir);
  const target = state.targets.find((candidate) => targetMatchesScope(candidate, scope));
  if (!target) return null;
  return {
    ...target,
    controlPlane: normalizeControlPlane(target.controlPlane),
    files: sortedFiles(target.files),
  };
}

export async function writeSyncTarget(projectDir: string, input: SyncTarget): Promise<void> {
  const target: SyncTarget = {
    ...input,
    controlPlane: normalizeControlPlane(input.controlPlane),
    files: sortedFiles(input.files),
  };
  if (!isSyncTarget(target)) throw invalidSyncStateError();

  const state = await readSyncState(projectDir);
  const targets = state.targets
    .filter((candidate) => !targetMatchesScope(candidate, target))
    .map((candidate) => ({
      ...candidate,
      controlPlane: normalizeControlPlane(candidate.controlPlane),
      files: sortedFiles(candidate.files),
    }));
  targets.push(target);
  targets.sort((left, right) => targetSortKey(left).localeCompare(targetSortKey(right)));

  const directory = join(projectDir, SYNC_STATE_DIRECTORY);
  const inspected = await inspectSyncStatePath(projectDir);
  if (!inspected.directoryExists) await Deno.mkdir(directory, { recursive: true });
  await inspectSyncStatePath(projectDir);

  const temporaryPath = join(
    directory,
    `.${SYNC_STATE_FILENAME}.${crypto.randomUUID()}.tmp`,
  );
  try {
    await Deno.writeTextFile(
      temporaryPath,
      `${JSON.stringify({ version: SYNC_STATE_VERSION, targets }, null, 2)}\n`,
    );
    await Deno.rename(temporaryPath, syncStatePath(projectDir));
  } catch (error) {
    try {
      await Deno.remove(temporaryPath);
    } catch (removeError) {
      if (!isNotFoundError(removeError)) throw removeError;
    }
    throw error;
  }
}
