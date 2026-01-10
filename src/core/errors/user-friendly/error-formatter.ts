import { bold, cyan, dim, red, yellow } from "@veryfront/compat/console";
import { ERROR_SOLUTIONS } from "./error-catalog.ts";
import { identifyError } from "./error-identifier.ts";

export function formatUserError(error: Error): string {
  const output: string[] = [];

  output.push("");
  output.push(red(bold("✖ Error: ")) + bold(error.message));
  output.push("");

  const errorKey = identifyError(error);
  const solution = ERROR_SOLUTIONS[errorKey];

  if (solution) {
    if (solution.message) {
      output.push(yellow("Problem: ") + solution.message);
      output.push("");
    }

    if (solution.steps && solution.steps.length > 0) {
      output.push(cyan("How to fix:"));
      for (const [i, step] of solution.steps.entries()) {
        output.push(`  ${dim(`${i + 1}.`)} ${step}`);
      }
      output.push("");
    }

    if (solution.example) {
      output.push(cyan("Example:"));
      output.push("");
      for (const line of solution.example.split("\n")) {
        output.push(`  ${dim(line)}`);
      }
      output.push("");
    }

    if (solution.docs) {
      output.push(dim("Learn more: ") + cyan(solution.docs));
      output.push("");
    }
  } else {
    if (error.stack) {
      output.push(yellow("Stack trace:"));
      const stackLines = error.stack.split("\n").slice(1, 4);
      for (const line of stackLines) {
        output.push(dim(`  ${line.trim()}`));
      }
      output.push("");
    }

    output.push(dim("For help, run: ") + cyan("veryfront doctor"));
    output.push("");
  }

  return output.join("\n");
}
