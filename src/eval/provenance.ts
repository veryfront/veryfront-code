import { join } from "@std/path";
import { VERSION } from "#veryfront/utils/version-constant.ts";
import type { EvalRunProvenance } from "./types.ts";

type Env = Record<string, string | undefined>;

const MAX_UNTRACKED_FILE_BYTES = 16 * 1024 * 1024;
const MAX_UNTRACKED_PATH_LENGTH = 4_096;

function isSafeUntrackedPath(path: string): boolean {
  if (
    path.length === 0 || path.length > MAX_UNTRACKED_PATH_LENGTH || path.includes("\0") ||
    path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)
  ) {
    return false;
  }
  return !path.replaceAll("\\", "/").split("/").some((segment) => segment === "..");
}

export type EvalGitProvenance = NonNullable<EvalRunProvenance["git"]>;

export type EvalCommandResult = {
  code: number;
  stdout: string;
  stderr?: string;
};

export type EvalCommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string },
) => Promise<EvalCommandResult>;

export type EvalFileReader = (path: string) => Promise<Uint8Array>;

export interface CreateEvalRunProvenanceOptions {
  env?: Env;
  git?: EvalGitProvenance;
  frameworkVersion?: string;
}

export interface ResolveEvalRunProvenanceOptions extends CreateEvalRunProvenanceOptions {
  projectDir?: string;
  commandRunner?: EvalCommandRunner;
  fileReader?: EvalFileReader;
}

function firstValue(env: Env, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function collectEnv(): Env {
  return {
    AG_UI_EVAL_BRANCH_ID: Deno.env.get("AG_UI_EVAL_BRANCH_ID"),
    AG_UI_EVAL_PROJECT_ID: Deno.env.get("AG_UI_EVAL_PROJECT_ID"),
    AG_UI_EVAL_PROJECT_SLUG: Deno.env.get("AG_UI_EVAL_PROJECT_SLUG"),
    AG_UI_EVAL_RELEASE_ID: Deno.env.get("AG_UI_EVAL_RELEASE_ID"),
    CI: Deno.env.get("CI"),
    GITHUB_ACTIONS: Deno.env.get("GITHUB_ACTIONS"),
    GITHUB_REF_NAME: Deno.env.get("GITHUB_REF_NAME"),
    GITHUB_SHA: Deno.env.get("GITHUB_SHA"),
    TENANT_BRANCH_ID: Deno.env.get("TENANT_BRANCH_ID"),
    TENANT_DEPLOYMENT_ID: Deno.env.get("TENANT_DEPLOYMENT_ID"),
    TENANT_ENVIRONMENT: Deno.env.get("TENANT_ENVIRONMENT"),
    TENANT_PROJECT_ID: Deno.env.get("TENANT_PROJECT_ID"),
    TENANT_PROJECT_SLUG: Deno.env.get("TENANT_PROJECT_SLUG"),
    TENANT_RELEASE_ID: Deno.env.get("TENANT_RELEASE_ID"),
    VERCEL_ENV: Deno.env.get("VERCEL_ENV"),
    VERYFRONT_BRANCH_REF: Deno.env.get("VERYFRONT_BRANCH_REF"),
    VERYFRONT_DEPLOYMENT_ID: Deno.env.get("VERYFRONT_DEPLOYMENT_ID"),
    VERYFRONT_ENVIRONMENT: Deno.env.get("VERYFRONT_ENVIRONMENT"),
    VERYFRONT_PROJECT_ID: Deno.env.get("VERYFRONT_PROJECT_ID"),
    VERYFRONT_PROJECT_SLUG: Deno.env.get("VERYFRONT_PROJECT_SLUG"),
    VERYFRONT_RELEASE_ID: Deno.env.get("VERYFRONT_RELEASE_ID"),
  };
}

function createCloudProvenance(env: Env): EvalRunProvenance["cloud"] | undefined {
  const entries = Object.entries({
    projectId: firstValue(env, [
      "TENANT_PROJECT_ID",
      "VERYFRONT_PROJECT_ID",
      "AG_UI_EVAL_PROJECT_ID",
    ]),
    projectSlug: firstValue(env, [
      "TENANT_PROJECT_SLUG",
      "VERYFRONT_PROJECT_SLUG",
      "AG_UI_EVAL_PROJECT_SLUG",
    ]),
    releaseId: firstValue(env, [
      "TENANT_RELEASE_ID",
      "VERYFRONT_RELEASE_ID",
      "AG_UI_EVAL_RELEASE_ID",
    ]),
    deploymentId: firstValue(env, ["TENANT_DEPLOYMENT_ID", "VERYFRONT_DEPLOYMENT_ID"]),
    branchId: firstValue(env, ["TENANT_BRANCH_ID", "AG_UI_EVAL_BRANCH_ID"]),
    branchRef: firstValue(env, ["VERYFRONT_BRANCH_REF", "GITHUB_REF_NAME"]),
    environment: firstValue(env, ["VERYFRONT_ENVIRONMENT", "TENANT_ENVIRONMENT", "VERCEL_ENV"]),
  }).filter((entry): entry is [keyof NonNullable<EvalRunProvenance["cloud"]>, string] =>
    entry[1] !== undefined
  );

  return entries.length > 0
    ? Object.fromEntries(entries) as NonNullable<EvalRunProvenance["cloud"]>
    : undefined;
}

function createSource(
  cloud: EvalRunProvenance["cloud"] | undefined,
  git: EvalGitProvenance | undefined,
): EvalRunProvenance["source"] {
  if (cloud?.releaseId) return { kind: "release", id: cloud.releaseId };
  if (cloud?.deploymentId) return { kind: "deployment", id: cloud.deploymentId };
  if (cloud?.branchId) return { kind: "preview", id: cloud.branchId };
  if (cloud?.branchRef) return { kind: "preview", id: cloud.branchRef };
  if (git?.sha) return { kind: "git", id: git.sha };
  if (cloud?.projectId || cloud?.projectSlug) {
    return { kind: "workspace", id: cloud.projectSlug ?? cloud.projectId };
  }
  return { kind: "unknown" };
}

function createEnvironment(
  env: Env,
  cloud: EvalRunProvenance["cloud"] | undefined,
  git: EvalGitProvenance | undefined,
): EvalRunProvenance["environment"] {
  if (
    cloud?.releaseId || cloud?.deploymentId || cloud?.branchId || cloud?.projectId ||
    cloud?.projectSlug
  ) {
    return "cloud";
  }
  if (env.GITHUB_ACTIONS === "true" || env.CI === "true") return "ci";
  if (git?.sha || git?.branch) return "local";
  return "unknown";
}

/** Build stable provenance metadata from explicit git/cloud inputs. */
export function createEvalRunProvenance(
  options: CreateEvalRunProvenanceOptions = {},
): EvalRunProvenance {
  const env = options.env ?? collectEnv();
  const ciGit = firstValue(env, ["GITHUB_SHA"]);
  const git = options.git ?? (ciGit
    ? {
      sha: ciGit,
      branch: firstValue(env, ["GITHUB_REF_NAME"]),
    }
    : undefined);
  const cloud = createCloudProvenance(env);

  return {
    kind: "eval-run-provenance",
    environment: createEnvironment(env, cloud, git),
    source: createSource(cloud, git),
    frameworkVersion: options.frameworkVersion ?? VERSION,
    ...(git ? { git } : {}),
    ...(cloud ? { cloud } : {}),
  };
}

async function defaultCommandRunner(
  command: string,
  args: string[],
  options: { cwd: string },
): Promise<EvalCommandResult> {
  const result = await new Deno.Command(command, {
    args,
    cwd: options.cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return {
    code: result.code,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
}

async function runGit(
  runner: EvalCommandRunner,
  projectDir: string,
  args: string[],
  options: { trim?: boolean } = {},
): Promise<string | undefined> {
  try {
    const result = await runner("git", args, { cwd: projectDir });
    if (result.code !== 0) return undefined;
    return options.trim === false ? result.stdout : result.stdout.trim();
  } catch {
    return undefined;
  }
}

async function sha256Hex(value: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(value));
}

async function sha256Bytes(value: Uint8Array): Promise<string> {
  const bytes = new Uint8Array(value.byteLength);
  bytes.set(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseNullSeparated(value: string | undefined): string[] {
  if (!value) return [];
  return value.split("\0").filter(Boolean).sort();
}

async function hashUntrackedFiles(
  projectDir: string,
  paths: string[],
  readFile: EvalFileReader,
): Promise<string> {
  const entries: string[] = [];
  for (const relativePath of paths) {
    if (!isSafeUntrackedPath(relativePath)) {
      entries.push(`${relativePath}\0unsafe-path`);
      continue;
    }
    try {
      const content = await readFile(join(projectDir, relativePath));
      entries.push(
        content.byteLength > MAX_UNTRACKED_FILE_BYTES
          ? `${relativePath}\0oversized:${content.byteLength}`
          : `${relativePath}\0${await sha256Bytes(content)}`,
      );
    } catch {
      entries.push(`${relativePath}\0unreadable`);
    }
  }
  return entries.join("\0");
}

async function resolveGitProvenance(
  projectDir: string,
  runner: EvalCommandRunner,
  readFile: EvalFileReader,
): Promise<EvalGitProvenance | undefined> {
  const sha = await runGit(runner, projectDir, ["rev-parse", "HEAD"]);
  const branch = await runGit(runner, projectDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = await runGit(runner, projectDir, ["status", "--porcelain=v1"]);
  const diff = await runGit(runner, projectDir, ["diff", "--binary", "HEAD", "--"]);
  const untracked = await runGit(runner, projectDir, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ], { trim: false });
  const dirty = status !== undefined ? status.length > 0 : undefined;

  if (!sha && !branch && dirty === undefined) return undefined;

  const untrackedHashInput = await hashUntrackedFiles(
    projectDir,
    parseNullSeparated(untracked),
    readFile,
  );

  return {
    ...(sha ? { sha } : {}),
    ...(branch ? { branch } : {}),
    ...(dirty !== undefined ? { dirty } : {}),
    ...(dirty
      ? { dirtyHash: await sha256Hex(`${status ?? ""}\n${diff ?? ""}\n${untrackedHashInput}`) }
      : {}),
  };
}

/** Resolve local or Cloud provenance for an eval run without failing the eval if git metadata is unavailable. */
export async function resolveEvalRunProvenance(
  options: ResolveEvalRunProvenanceOptions = {},
): Promise<EvalRunProvenance> {
  const projectDir = options.projectDir ?? Deno.cwd();
  const runner = options.commandRunner ?? defaultCommandRunner;
  const readFile = options.fileReader ?? Deno.readFile;
  const git = options.git ?? await resolveGitProvenance(projectDir, runner, readFile);
  return createEvalRunProvenance({
    env: options.env,
    git,
    frameworkVersion: options.frameworkVersion,
  });
}
