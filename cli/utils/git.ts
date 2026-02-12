/**
 * Git utilities for project initialization
 * @module cli/utils/git
 */

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
    // Initialize git
    const initResult = await runCommand("git", {
      args: ["init"],
      cwd: projectDir,
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
      capture: true,
    });

    if (addResult.code !== 0) {
      logger.debug("git add failed");
      return false;
    }

    // Create initial commit
    const commitResult = await runCommand("git", {
      args: ["commit", "-m", `Initial commit: ${projectName}`],
      cwd: projectDir,
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
