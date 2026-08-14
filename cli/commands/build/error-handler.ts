import { brand, dim } from "#cli/ui";
import { cliLogger, isVerbose, logError } from "#cli/utils";
import { exit, getStdout } from "veryfront/platform";

function deepestErrorCause(error: Error): Error {
  const seen = new Set<Error>();
  let current = error;
  for (let depth = 0; depth < 8; depth++) {
    if (seen.has(current)) break;
    seen.add(current);
    const cause = Object.getOwnPropertyDescriptor(current, "cause");
    if (!cause || !("value" in cause) || !(cause.value instanceof Error)) break;
    current = cause.value;
  }
  return current;
}

export function handleBuildError(error: unknown): never {
  getStdout()?.write?.(`\r${" ".repeat(80)}\r`);

  const message = error instanceof Error ? error.message : String(error);
  console.log();
  logError(message);

  const diagnosticError = error instanceof Error ? deepestErrorCause(error) : undefined;
  if (isVerbose() && diagnosticError?.stack) {
    const isUnderlyingCause = diagnosticError !== error;
    cliLogger.error(`\n${dim(isUnderlyingCause ? "Underlying stack trace:" : "Stack trace:")}`);
    const firstLine = isUnderlyingCause ? 0 : 1;
    cliLogger.error(dim(diagnosticError.stack.split("\n").slice(firstLine, 5).join("\n")));
  } else if (diagnosticError && diagnosticError !== error) {
    cliLogger.error(
      `  Run ${brand("veryfront build --verbose")} to show the underlying stack trace.`,
    );
  }
  cliLogger.error(`  Run ${brand("veryfront build --help")} for usage.`);
  cliLogger.error("");

  if (import.meta.main) exit(1);
  throw error;
}
