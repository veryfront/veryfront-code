import { createFileSystem, env, getEnv, runCommand } from "veryfront/platform";
import { isNotFoundError, lstat, realPath } from "#veryfront/platform/compat/fs.ts";
import { join, relative } from "veryfront/platform/path";
import type { ApiClient } from "./config.ts";

const RECEIPT_VERSION = 2 as const;
const RECEIPT_DIRECTORY = ".veryfront";
const RECEIPT_FILENAME = "push-receipt.json";
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
  clean?: boolean;
  requireClean?: boolean;
}

function receiptPath(projectDir: string): string {
  return join(projectDir, RECEIPT_DIRECTORY, RECEIPT_FILENAME);
}

function receiptPathError(): Error {
  return new Error(
    `Veryfront cannot use ${RECEIPT_DIRECTORY}/${RECEIPT_FILENAME} through a symbolic link. Remove the link and run the command again.`,
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
    throw new Error(`${RECEIPT_DIRECTORY}/${RECEIPT_FILENAME} must be a file.`);
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
        args: ["status", "--porcelain=v1", "--untracked-files=all"],
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
    clean: sourcesAgree && status.success &&
      !(status.stdout ?? "").split("\n").some((line) =>
        line !== "" && line !== `?? ${RECEIPT_DIRECTORY}/${RECEIPT_FILENAME}`
      ),
  };
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
  await inspectReceiptPath(projectDir);
  try {
    const value: unknown = JSON.parse(await fs.readTextFile(receiptPath(projectDir)));
    return isPushReceipt(value) ? value : null;
  } catch {
    return null;
  }
}

export async function clearPushReceipt(projectDir: string): Promise<void> {
  const fs = createFileSystem();
  const path = receiptPath(projectDir);
  const inspected = await inspectReceiptPath(projectDir);
  if (inspected.receiptExists) await fs.remove(path);
}

export function validatePushReceipt(
  receipt: PushReceipt,
  expected: PushReceiptExpectation,
): string {
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
    throw new Error("The latest push targeted a different branch. Run veryfront push again.");
  }
  if (!receipt.commitSha) {
    throw new Error("The latest push has no Git commit SHA. Commit the source and push again.");
  }
  if (expected.commitSha && receipt.commitSha !== expected.commitSha.toLowerCase()) {
    throw new Error("The latest push came from a different commit. Run veryfront push again.");
  }
  if (expected.requireClean && (!receipt.clean || expected.clean === false)) {
    throw new Error(
      "The latest push included uncommitted changes. Commit the source and push again.",
    );
  }
  return receipt.commitSha;
}
