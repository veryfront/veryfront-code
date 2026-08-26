/**
 * Git utilities for project initialization
 * @module cli/utils/git
 */

import { env } from "#cli/process-env";
import { runCommand } from "veryfront/platform";
import { cliLogger as logger } from "#cli/utils";

/**
 * Initialize a git repository and create an initial commit
 */
export async function initializeGitRepo(
  projectDir: string,
  projectName: string,
): Promise<boolean> {
  try {
    const gitEnv = Object.fromEntries(
      Object.entries(env()).filter(([key]) =>
        !key.startsWith("GIT_") ||
        key.startsWith("GIT_AUTHOR_") ||
        key.startsWith("GIT_COMMITTER_")
      ),
    );

    // Initialize git
    const initResult = await runCommand("git", {
      args: ["init"],
      cwd: projectDir,
      clearEnv: true,
      env: gitEnv,
      capture: true,
    });

    if (initResult.code !== 0) {
      logger.debug("git init failed");
      return false;
    }

    // Stage all files
    const addResult = await runCommand("git", {
      args: ["add", "-A"],
      cwd: projectDir,
      clearEnv: true,
      env: gitEnv,
      capture: true,
    });

    if (addResult.code !== 0) {
      logger.debug("git add failed");
      return false;
    }

    // Create initial commit (--no-gpg-sign avoids hanging when GPG signing is configured)
    const commitResult = await runCommand("git", {
      args: ["commit", "-m", `Initial commit: ${projectName}`, "--no-gpg-sign"],
      cwd: projectDir,
      clearEnv: true,
      env: gitEnv,
      capture: true,
    });

    if (commitResult.code !== 0) {
      logger.debug("git commit failed");
      return false;
    }

    return true;
  } catch (error) {
    logger.debug(`Git initialization failed: ${error}`);
    return false;
  }
}
