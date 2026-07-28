import { dim } from "#cli/ui";
import { cliLogger, isVerbose } from "#cli/utils";
import { exit, getStdout } from "veryfront/platform";

export function handleBuildError(error: unknown): never {
  getStdout()?.write?.(`\r${" ".repeat(80)}\r`);

  const message = error instanceof Error ? error.message : String(error);
  cliLogger.error(`\n✗ ${message}`);

  if (isVerbose() && error instanceof Error && error.stack) {
    cliLogger.error(`\n${dim("Stack trace:")}`);
    cliLogger.error(dim(error.stack.split("\n").slice(1, 5).join("\n")));
  }
  cliLogger.error("");

  if (import.meta.main) exit(1);
  throw error;
}
