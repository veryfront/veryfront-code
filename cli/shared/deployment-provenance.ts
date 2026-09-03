import { env } from "#cli/process-env";
import { createFileSystem, getEnv } from "veryfront/platform";
import { runCommand } from "#cli/process-command";
import { isNotFoundError, lstat, realPath } from "veryfront/fs";
import { join, relative } from "veryfront/platform/path";
import { DEPLOYMENT_ERROR } from "veryfront/errors";
import type { ApiClient } from "./config.ts";

const RECEIPT_VERSION = 2 as const;
const RECEIPT_DIRECTORY = ".veryfront";
const RECEIPT_FILENAME = "push-receipt.json";
export const PUSH_RECEIPT_RELATIVE_PATH = `${RECEIPT_DIRECTORY}/${RECEIPT_FILENAME}`;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40,64}$/i;
const SOURCE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

export interface SourceFile {
  path: string;
  content: string;
}

export interface PushReceipt {
  version: typeof RECEIPT_VERSION;
  controlPlane: string;
  projectId: string;
  projectSlug: string;
  branch: string;
  commitSha: string | null;
  sourceDigest: string;
  /**
   * Digest of the local file set the push uploaded, before the remote tree it
   * produced folded in any preserved remote-only file.
   *
   * `sourceDigest` describes that remote tree, so it cannot be recomputed from
   * this directory. This one can: recomputing it is direct evidence about
   * whether the source still matches the upload, and unlike {@link clean} it
   * does not inherit Git's blind spot for a file `.gitignore` hides while
   * `.vfignore` does not. Optional so a receipt written by an earlier CLI still
   * loads and falls back to the Git observation.
   */
  localSourceDigest?: string;
  clean: boolean;
  pushedAt: string;
}

export interface GitSource {
  commitSha: string | null;
  clean: boolean;
}

export interface ProjectTarget {
  id: string;
  slug: string;
}

interface PushReceiptExpectation {
  controlPlane: string;
  projectId: string;
  projectSlug: string;
  branch: string;
  commitSha?: string | null;
  /** Whether the local checkout is clean right now, from {@link resolveGitSource}. */
  clean: boolean;
  /**
   * Digest of the file set `veryfront push` would upload from this directory
   * right now, or `null` when the directory could not be scanned.
   *
   * Where the receipt carries one too, this settles whether the source still
   * matches the upload and {@link clean} is not consulted. Anything but a
   * digest is a refusal there: the proof that receipt promises cannot be
   * recomputed, so the deploy fails closed instead of quietly dropping back to
   * the weaker Git observation, and a caller that omits the field entirely
   * fails closed the same way rather than opting out of the check.
   */
  localSourceDigest?: string | null;
  /**
   * Whether a clean receipt has to be backed by a clean checkout.
   *
   * Only an operation that owns the local source can read the working tree as
   * evidence about the upload. Promoting a project named by slug never uploads
   * this directory, so its edits say nothing about what was pushed and must not
   * refuse the promotion. Omitting this enforces the check, so a caller that
   * forgets it fails closed; `clean` still reports what was observed either way.
   */
  enforceClean?: boolean;
}

function receiptPath(projectDir: string): string {
  return join(projectDir, RECEIPT_DIRECTORY, RECEIPT_FILENAME);
}

function receiptPathError(): Error {
  return new Error(
    `Veryfront cannot use ${PUSH_RECEIPT_RELATIVE_PATH} through a symbolic link. Remove the link and run the command again.`,
  );
}

function invalidReceiptError(): Error {
  return new Error(
    `Veryfront could not read ${PUSH_RECEIPT_RELATIVE_PATH}; remove it and run veryfront push again.`,
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

async function inspectReceiptPath(
  projectDir: string,
): Promise<{ directoryExists: boolean; receiptExists: boolean }> {
  const directory = join(projectDir, RECEIPT_DIRECTORY);
  const directoryInfo = await lstatIfPresent(directory);
  if (!directoryInfo) return { directoryExists: false, receiptExists: false };
  if (directoryInfo.isSymlink) throw receiptPathError();
  if (!directoryInfo.isDirectory) {
    throw new Error(`${RECEIPT_DIRECTORY} must be a directory inside the project.`);
  }

  const [canonicalProject, canonicalDirectory] = await Promise.all([
    realPath(projectDir),
    realPath(directory),
  ]);
  if (relative(canonicalProject, canonicalDirectory) !== RECEIPT_DIRECTORY) {
    throw receiptPathError();
  }

  const receiptInfo = await lstatIfPresent(receiptPath(projectDir));
  if (!receiptInfo) return { directoryExists: true, receiptExists: false };
  if (receiptInfo.isSymlink) throw receiptPathError();
  if (!receiptInfo.isFile) {
    throw new Error(`${PUSH_RECEIPT_RELATIVE_PATH} must be a file.`);
  }
  return { directoryExists: true, receiptExists: true };
}

function isPushReceipt(value: unknown): value is PushReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Record<string, unknown>;
  return receipt.version === RECEIPT_VERSION &&
    typeof receipt.controlPlane === "string" &&
    typeof receipt.projectId === "string" &&
    typeof receipt.projectSlug === "string" &&
    typeof receipt.branch === "string" &&
    (receipt.commitSha === null ||
      (typeof receipt.commitSha === "string" && COMMIT_SHA_PATTERN.test(receipt.commitSha))) &&
    typeof receipt.sourceDigest === "string" &&
    SOURCE_DIGEST_PATTERN.test(receipt.sourceDigest) &&
    (receipt.localSourceDigest === undefined ||
      (typeof receipt.localSourceDigest === "string" &&
        SOURCE_DIGEST_PATTERN.test(receipt.localSourceDigest))) &&
    typeof receipt.clean === "boolean" &&
    typeof receipt.pushedAt === "string";
}

export async function computeSourceDigest(files: SourceFile[]): Promise<string> {
  const canonicalFiles = files.map(({ path, content }) => [path, content] as const).sort(
    ([left], [right]) => left < right ? -1 : left > right ? 1 : 0,
  );
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalFiles));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

export function normalizeControlPlane(apiUrl: string): string {
  const url = new URL(apiUrl);
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}`;
}

export function getProjectTarget(
  client: ApiClient,
  projectReference: string,
): Promise<ProjectTarget> {
  return client.get<ProjectTarget>(`/projects/${projectReference}`);
}

export async function resolveGitSource(projectDir: string): Promise<GitSource> {
  const envSha = getEnv("GITHUB_SHA")?.trim();
  const gitEnv = env();
  for (const key of Object.keys(gitEnv)) {
    if (key.startsWith("GIT_")) delete gitEnv[key];
  }
  let commandResults;
  try {
    commandResults = await Promise.all([
      runCommand("git", {
        args: ["rev-parse", "HEAD"],
        cwd: projectDir,
        clearEnv: true,
        env: gitEnv,
        capture: true,
        timeoutMs: 5_000,
      }),
      runCommand("git", {
        // Ask Git to exclude CLI state before it formats porcelain paths.
        // Porcelain v1 otherwise reports paths relative to the repository root,
        // so parsing for a leading `.veryfront/` fails when projectDir is a
        // nested monorepo package.
        //
        // The `.` pathspec that carries the exclusion also scopes cleanliness
        // to projectDir. That is the honest reading for a nested package: only
        // projectDir is uploaded, so an edit in a sibling package cannot change
        // the pushed source and must not be reported as a source change. It
        // narrows the flag every push receipt records, not just deploy's gate.
        //
        // Cleanliness stays a proxy for source equality, not a proof of it. A
        // supported file that `.gitignore` hides but `.vfignore` and
        // DEFAULT_IGNORE_PATTERNS do not (cli/sync/ignore.ts reads only
        // `.vfignore`) is uploaded by push yet stays invisible here, so editing
        // one leaves the checkout clean. `localSourceDigest` is the proof that
        // closes that gap; this flag is provenance metadata and the fallback
        // for receipts written before the digest existed.
        args: [
          "status",
          "--porcelain=v1",
          "--untracked-files=all",
          "--",
          ".",
          ":(exclude).veryfront",
          ":(exclude).veryfront/**",
        ],
        cwd: projectDir,
        clearEnv: true,
        env: gitEnv,
        capture: true,
        timeoutMs: 5_000,
      }),
    ]);
  } catch {
    return {
      commitSha: envSha && COMMIT_SHA_PATTERN.test(envSha) ? envSha.toLowerCase() : null,
      clean: false,
    };
  }

  const [head, status] = commandResults;

  const headSha = head.success ? head.stdout?.trim() : undefined;
  const normalizedEnvSha = envSha && COMMIT_SHA_PATTERN.test(envSha) ? envSha.toLowerCase() : null;
  const normalizedHeadSha = headSha && COMMIT_SHA_PATTERN.test(headSha)
    ? headSha.toLowerCase()
    : null;
  const sourcesAgree = (!envSha || normalizedEnvSha !== null) &&
    (!normalizedEnvSha || !normalizedHeadSha || normalizedEnvSha === normalizedHeadSha);
  const commitSha = sourcesAgree ? normalizedEnvSha ?? normalizedHeadSha : null;

  return {
    commitSha,
    clean: sourcesAgree && status.success && (status.stdout ?? "").trim() === "",
  };
}

/**
 * Return tracked source paths deleted from the current checkout.
 *
 * Git only knows about deletions of files it tracks, so a file that was
 * uploaded while untracked and then deleted locally is not listed and stays on
 * the remote through a refresh push. The refresh is therefore a source update,
 * not a full mirror; `veryfront push --prune` remains the way to reconcile
 * remote-only files. The digest stays consistent either way, because the
 * receipt records the remote tree the push produced.
 */
function deletedGitSourcePathsUnavailable(): Error {
  return DEPLOYMENT_ERROR.create({
    detail:
      "Could not determine deleted Git source paths for the automatic source refresh. Run veryfront push, then retry the deploy.",
  });
}

export async function resolveDeletedGitSourcePaths(projectDir: string): Promise<string[]> {
  const gitEnv = env();
  for (const key of Object.keys(gitEnv)) {
    if (key.startsWith("GIT_")) delete gitEnv[key];
  }

  let result;
  try {
    result = await runCommand("git", {
      args: [
        "diff",
        "--no-renames",
        "--name-only",
        "--diff-filter=D",
        "-z",
        "--relative",
        "HEAD",
        "--",
        ".",
      ],
      cwd: projectDir,
      clearEnv: true,
      env: gitEnv,
      capture: true,
      timeoutMs: 5_000,
    });
  } catch {
    throw deletedGitSourcePathsUnavailable();
  }
  if (!result.success) {
    throw deletedGitSourcePathsUnavailable();
  }
  return (result.stdout ?? "").split("\0").filter((path) => path.length > 0);
}

export async function areSourceFilesTracked(
  projectDir: string,
  files: readonly SourceFile[],
): Promise<boolean> {
  if (files.length === 0) return true;

  const gitEnv = env();
  for (const key of Object.keys(gitEnv)) {
    if (key.startsWith("GIT_")) delete gitEnv[key];
  }

  try {
    const result = await runCommand("git", {
      args: ["ls-files", "--cached", "-z"],
      cwd: projectDir,
      clearEnv: true,
      env: gitEnv,
      capture: true,
      timeoutMs: 5_000,
    });
    if (!result.success) return false;

    const trackedPaths = new Set(
      (result.stdout ?? "").split("\0").filter((path) => path.length > 0),
    );
    return files.every((file) => trackedPaths.has(file.path));
  } catch {
    return false;
  }
}

export async function writePushReceipt(
  projectDir: string,
  receipt: Omit<PushReceipt, "version" | "pushedAt"> & { pushedAt?: string },
): Promise<PushReceipt> {
  const fs = createFileSystem();
  const directory = join(projectDir, RECEIPT_DIRECTORY);
  const value: PushReceipt = {
    version: RECEIPT_VERSION,
    ...receipt,
    controlPlane: normalizeControlPlane(receipt.controlPlane),
    commitSha: receipt.commitSha?.toLowerCase() ?? null,
    pushedAt: receipt.pushedAt ?? new Date().toISOString(),
  };

  const before = await inspectReceiptPath(projectDir);
  if (!before.directoryExists) await fs.mkdir(directory, { recursive: true });
  await inspectReceiptPath(projectDir);
  await fs.writeTextFile(receiptPath(projectDir), `${JSON.stringify(value, null, 2)}\n`);
  return value;
}

export async function readPushReceipt(projectDir: string): Promise<PushReceipt | null> {
  const fs = createFileSystem();
  const inspected = await inspectReceiptPath(projectDir);
  if (!inspected.receiptExists) return null;
  try {
    const value: unknown = JSON.parse(await fs.readTextFile(receiptPath(projectDir)));
    if (isPushReceipt(value)) return value;
  } catch {
    throw invalidReceiptError();
  }
  throw invalidReceiptError();
}

export async function clearPushReceipt(projectDir: string): Promise<void> {
  const fs = createFileSystem();
  const path = receiptPath(projectDir);
  const inspected = await inspectReceiptPath(projectDir);
  if (inspected.receiptExists) await fs.remove(path);
}

/**
 * Refuse a receipt that no longer describes the source in this directory.
 *
 * The commit check alone cannot see edits that never reached a commit: they
 * leave HEAD where the receipt left it. Two kinds of evidence close that gap,
 * and the stronger one wins.
 *
 * A recomputed local source digest is a direct comparison of the file set push
 * uploads, so it decides the question outright wherever the receipt carries one
 * too. It sees exactly what push sees, including a file `.gitignore` hides
 * while `.vfignore` does not, and it clears a working tree that is dirty only
 * in files no push would upload. A receipt that carries a digest the directory
 * cannot produce right now is refused rather than downgraded to the Git check:
 * a directory too broken to scan is also too broken to prove anything.
 *
 * Git cleanliness is the fallback for receipts written before that digest
 * existed. It is a proxy, not a proof: a receipt written from a clean checkout
 * promises the pushed source was exactly that commit, so a tree that is no
 * longer clean is provably not what was pushed, while a receipt that was
 * already dirty proves nothing either way and keeps the push-then-deploy flow
 * it has always had. That leaves one gap this check cannot close, by
 * construction: a receipt from a pre-digest CLI carries no digest to compare,
 * so an edit `.gitignore` hides while `.vfignore` does not stays invisible
 * until the next `veryfront push` rewrites the receipt with a digest.
 */
function assertReceiptDescribesLocalSource(
  receipt: PushReceipt,
  expected: PushReceiptExpectation,
): void {
  if (receipt.localSourceDigest !== undefined) {
    if (expected.localSourceDigest === null || expected.localSourceDigest === undefined) {
      throw new Error(
        "Veryfront could not verify that this directory still holds the source the latest push uploaded. " +
          "Run veryfront push again to deploy the current source.",
      );
    }
    if (receipt.localSourceDigest === expected.localSourceDigest) return;
    throw new Error(
      "This directory no longer holds the source the latest push uploaded. " +
        "Run veryfront push again to deploy the current source.",
    );
  }
  if (!receipt.clean || expected.clean) return;
  // With no current commit to name, "uncommitted changes" would misdescribe
  // a project that is no longer a Git checkout at all; the refusal is the
  // same, only the reason shown to the operator differs.
  throw new Error(
    expected.commitSha
      ? "The latest push came from a clean checkout, but this project has uncommitted changes. " +
        "Run veryfront push again to deploy them."
      : "The latest push came from a clean checkout, but this project no longer resolves to a Git commit. " +
        "Run veryfront push again to deploy the current source.",
  );
}

export function validatePushReceipt(
  receipt: PushReceipt,
  expected: PushReceiptExpectation,
): string | null {
  if (
    normalizeControlPlane(receipt.controlPlane) !== normalizeControlPlane(expected.controlPlane)
  ) {
    throw new Error(
      "The latest push targeted a different control plane. Run veryfront push again.",
    );
  }
  if (receipt.projectId !== expected.projectId || receipt.projectSlug !== expected.projectSlug) {
    throw new Error("The latest push targeted a different project. Run veryfront push again.");
  }
  if (receipt.branch !== expected.branch) {
    throw new Error(
      `The latest push is for branch "${receipt.branch}", but deploy targets "${expected.branch}". ` +
        `Run veryfront deploy --branch ${receipt.branch} to deploy the latest push, ` +
        `or veryfront push --branch ${expected.branch} to preview ${expected.branch} first.`,
    );
  }
  if (expected.commitSha && receipt.commitSha !== expected.commitSha.toLowerCase()) {
    throw new Error(
      receipt.commitSha
        ? "The latest push came from a different commit. Run veryfront push again."
        : "The latest push has no Git commit SHA. Run veryfront push again from the checked-out commit.",
    );
  }
  if (expected.enforceClean !== false) assertReceiptDescribesLocalSource(receipt, expected);
  return receipt.commitSha;
}
