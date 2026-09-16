/**
 * Git ignore resolution for sync.
 *
 * Push, deploy, and pull defer to Git for which local files are ignored, so
 * every Git ignore source applies: `.gitignore` at any level,
 * `.git/info/exclude`, and `core.excludesFile`. Parsing `.gitignore` directly
 * would miss the last two, which is where local tooling (for example
 * Conductor's `.context/`) registers its scratch directories.
 */

import { env } from "#cli/process-env";
import { runCommand } from "#cli/process-command";
import { cliLogger } from "#cli/utils";
import { isNotFoundError, lstat } from "veryfront/fs";
import { hasGitMetadata } from "../shared/deployment-provenance.ts";

const GIT_IGNORE_TIMEOUT_MS = 30_000;

/** Process and filesystem seams, replaceable so the fallback rules unit test hermetically. */
export interface GitIgnoreDependencies {
  runCommand: typeof runCommand;
  hasGitMetadata: (projectDir: string) => Promise<boolean>;
  projectDirExists: (projectDir: string) => Promise<boolean>;
}

async function projectDirExists(projectDir: string): Promise<boolean> {
  try {
    await lstat(projectDir);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

const defaultDependencies: GitIgnoreDependencies = {
  runCommand,
  hasGitMetadata,
  projectDirExists,
};

function gitIgnoreUnavailableError(cause?: unknown): Error {
  return new Error(
    "Could not read Git ignore rules for this project. Ensure Git can inspect the project checkout and try again.",
    cause === undefined ? undefined : { cause },
  );
}

type GitIgnoreRun =
  | { kind: "output"; stdout: string; code: number }
  | { kind: "no-repository" };

/**
 * Run one Git ignore query from the project directory.
 *
 * `acceptedFailureCodes` lists exit codes that are answers rather than errors
 * (`git check-ignore` exits 1 when nothing is ignored). Outside a repository,
 * or when Git is missing and no repository surrounds the project, the query
 * reports `no-repository`. Any other failure inside a repository throws, so
 * sync never silently treats ignored files as project source.
 */
async function runGitIgnoreQuery(
  projectDir: string,
  args: string[],
  dependencies: GitIgnoreDependencies,
  acceptedFailureCodes: readonly number[] = [],
): Promise<GitIgnoreRun> {
  const gitEnv = env();
  for (const key of Object.keys(gitEnv)) {
    if (key.startsWith("GIT_")) delete gitEnv[key];
  }

  let result;
  try {
    result = await dependencies.runCommand("git", {
      args,
      cwd: projectDir,
      clearEnv: true,
      env: gitEnv,
      capture: true,
      timeoutMs: GIT_IGNORE_TIMEOUT_MS,
    });
  } catch (error) {
    // Git is not installed or could not start. That only matters when there
    // is a repository whose ignore rules we would otherwise skip.
    if (!(await dependencies.hasGitMetadata(projectDir))) return { kind: "no-repository" };
    cliLogger.debug("Failed to run git for ignore rules:", error);
    throw gitIgnoreUnavailableError(error);
  }

  if (result.outputTruncated) {
    cliLogger.debug("git output for ignore rules was truncated");
    throw gitIgnoreUnavailableError();
  }
  if (result.success || acceptedFailureCodes.includes(result.code)) {
    return { kind: "output", stdout: result.stdout ?? "", code: result.code };
  }
  if (/not a git repository/i.test(result.stderr ?? "")) return { kind: "no-repository" };
  if (!(await dependencies.hasGitMetadata(projectDir))) return { kind: "no-repository" };
  cliLogger.debug("git for ignore rules failed:", result.stderr);
  throw gitIgnoreUnavailableError();
}

/**
 * List the untracked local paths Git ignores below `projectDir`, relative to it.
 *
 * A directory Git ignores in full is listed once, without a trailing slash, and
 * stands for everything beneath it. Tracked files are never listed, even when
 * they match an ignore rule, because Git keeps managing them.
 *
 * Outside a Git repository this returns an empty list, so the `.vfignore` and
 * default rules alone decide. Inside one, a Git failure throws instead of
 * silently uploading files the checkout ignores.
 */
export async function loadGitIgnoredPaths(
  projectDir: string,
  dependencies: GitIgnoreDependencies = defaultDependencies,
): Promise<string[]> {
  // Pull may target a directory it has not created yet: nothing is ignored.
  if (!(await dependencies.projectDirExists(projectDir))) return [];

  const run = await runGitIgnoreQuery(
    projectDir,
    // `ls-files` prints paths relative to its working directory and limits the
    // listing to it, which matches the relative paths sync scans.
    ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
    dependencies,
  );
  if (run.kind === "no-repository") return [];

  return run.stdout
    .split("\0")
    .map((path) => path.replace(/\/+$/, ""))
    .filter((path) => path.length > 0);
}

/** Keep each `git check-ignore` command line well under the Windows limit. */
const CHECK_IGNORE_ARGUMENT_BUDGET = 24_000;

const C_STYLE_ESCAPES: Readonly<Record<string, number>> = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '"': 34,
  "\\": 92,
};

/** Undo Git's C-style quoting of a path it prints outside `-z` mode. */
export function unquoteGitPath(line: string): string {
  if (line.length < 2 || !line.startsWith('"') || !line.endsWith('"')) return line;
  const characters = [...line.slice(1, -1)];
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index]!;
    if (character !== "\\") {
      bytes.push(...encoder.encode(character));
      continue;
    }
    const next = characters[index + 1] ?? "";
    const octal = characters.slice(index + 1, index + 4).join("");
    if (/^[0-3][0-7]{2}$/.test(octal)) {
      bytes.push(Number.parseInt(octal, 8));
      index += 3;
    } else if (next in C_STYLE_ESCAPES) {
      bytes.push(C_STYLE_ESCAPES[next]!);
      index += 1;
    } else {
      bytes.push(...encoder.encode(character));
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/**
 * Return the given project-relative paths that Git's ignore rules match,
 * whether or not they exist locally.
 *
 * Pull uses this for remote paths: `git ls-files` only reports files already on
 * disk, so a remote file the checkout ignores would otherwise be written on
 * first pull. Tracked paths are never reported. Paths are checked in as few
 * `git check-ignore` processes as the command-line budget allows, normally one.
 * Outside a repository, or for a directory that does not exist yet, nothing is
 * reported; a Git failure inside a repository throws.
 */
export async function checkGitIgnoredPaths(
  projectDir: string,
  paths: Iterable<string>,
  dependencies: GitIgnoreDependencies = defaultDependencies,
): Promise<string[]> {
  const candidates = [...new Set(paths)].filter((path) => path.length > 0);
  if (candidates.length === 0) return [];
  if (!(await dependencies.projectDirExists(projectDir))) return [];

  const batches: string[][] = [];
  let batch: string[] = [];
  let batchLength = 0;
  for (const path of candidates) {
    // `./` keeps Git from reading a leading `:` as pathspec magic or a leading
    // `-` as an option.
    const argument = `./${path}`;
    if (batch.length > 0 && batchLength + argument.length > CHECK_IGNORE_ARGUMENT_BUDGET) {
      batches.push(batch);
      batch = [];
      batchLength = 0;
    }
    batch.push(argument);
    batchLength += argument.length + 1;
  }
  batches.push(batch);

  const ignored: string[] = [];
  for (const arguments_ of batches) {
    const run = await runGitIgnoreQuery(
      projectDir,
      ["-c", "core.quotePath=false", "check-ignore", ...arguments_],
      dependencies,
      [1],
    );
    if (run.kind === "no-repository") return [];
    if (run.code === 1) continue;
    for (const line of run.stdout.split("\n")) {
      if (!line) continue;
      ignored.push(unquoteGitPath(line).replace(/^\.\//, ""));
    }
  }
  return ignored;
}
