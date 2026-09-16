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

  const gitEnv = env();
  for (const key of Object.keys(gitEnv)) {
    if (key.startsWith("GIT_")) delete gitEnv[key];
  }

  let result;
  try {
    result = await dependencies.runCommand("git", {
      // `ls-files` prints paths relative to its working directory and limits
      // the listing to it, which matches the relative paths sync scans.
      args: ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
      cwd: projectDir,
      clearEnv: true,
      env: gitEnv,
      capture: true,
      timeoutMs: GIT_IGNORE_TIMEOUT_MS,
    });
  } catch (error) {
    // Git is not installed or could not start. That only matters when there
    // is a repository whose ignore rules we would otherwise skip.
    if (!(await dependencies.hasGitMetadata(projectDir))) return [];
    cliLogger.debug("Failed to run git ls-files for ignore rules:", error);
    throw gitIgnoreUnavailableError(error);
  }

  if (!result.success || result.outputTruncated) {
    if (!result.outputTruncated && /not a git repository/i.test(result.stderr ?? "")) {
      return [];
    }
    if (!result.outputTruncated && !(await dependencies.hasGitMetadata(projectDir))) return [];
    cliLogger.debug("git ls-files for ignore rules failed:", result.stderr);
    throw gitIgnoreUnavailableError();
  }

  return (result.stdout ?? "")
    .split("\0")
    .map((path) => path.replace(/\/+$/, ""))
    .filter((path) => path.length > 0);
}
