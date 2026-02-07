import { bold, cyan, dim, red } from "#cli/ui";
import { cliLogger } from "#cli/utils";
import { exit, getStdout } from "veryfront/platform";

export function handleBuildError(error: unknown): never {
  getStdout()?.write?.(`\r${" ".repeat(80)}\r`);

  cliLogger.error(`\n${red("✗")}${bold(red(" Build failed!\n"))}`);

  if (!(error instanceof Error)) {
    cliLogger.error(`${red("Error: ")}${String(error)}`);
    cliLogger.error(`\n${dim("For help, run: ")}${cyan("veryfront build --help")}`);

    if (import.meta.main) exit(1);
    throw error;
  }

  cliLogger.error(`${red("Error: ")}${error.message}`);

  const stack = error.stack;
  if (stack) {
    cliLogger.error(`\n${dim("Stack trace:")}`);
    cliLogger.error(dim(stack.split("\n").slice(1, 5).join("\n")));
  }

  cliLogger.error(`\n${dim("For help, run: ")}${cyan("veryfront build --help")}`);

  if (import.meta.main) exit(1);
  throw error;
}
