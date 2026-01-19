/**
 * Build Error Handler Module
 *
 * Handles build errors and displays user-friendly error messages.
 */

import { bold, cyan, dim, red } from "#veryfront/compat/console";
import { cliLogger } from "#veryfront/utils";
import { exit, getStdout } from "#veryfront/platform/compat/process.ts";

/**
 * Handle build error with user-friendly messaging
 */
export function handleBuildError(error: unknown): never {
  // Clear any progress indicators
  const stdout = getStdout();
  if (stdout?.write) {
    stdout.write(`\r${" ".repeat(80)}\r`);
  }

  cliLogger.error(`\n${red("✗")}${bold(red(" Build failed!\n"))}`);

  if (error instanceof Error) {
    cliLogger.error(red("Error: ") + error.message);
    if (error.stack) {
      cliLogger.error(`\n${dim("Stack trace:")}`);
      cliLogger.error(dim(error.stack.split("\n").slice(1, 5).join("\n")));
    }
  } else {
    cliLogger.error(red("Error: ") + String(error));
  }

  cliLogger.error(`\n${dim("For help, run: ")}${cyan("veryfront build --help")}`);

  if (import.meta.main) {
    exit(1);
  }
  throw error;
}
