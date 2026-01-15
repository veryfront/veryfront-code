import { bold, cyan, dim, red, yellow } from "@veryfront/compat/console";
import { ERROR_SOLUTIONS } from "./error-catalog.ts";
import { identifyError } from "./error-identifier.ts";
import { type BorderStyle, box } from "../../../cli/ui/box.ts";

const errorColor = "\x1b[38;2;239;68;68m"; // Red

/**
 * Format error as a polished box with solution
 */
export function formatErrorBox(error: Error): string {
  const errorKey = identifyError(error);
  const solution = ERROR_SOLUTIONS[errorKey];

  const content: string[] = [];
  content.push(error.message);

  if (solution) {
    if (solution.message) {
      content.push("");
      content.push(dim(solution.message));
    }

    if (solution.steps && solution.steps.length > 0) {
      content.push("");
      content.push(cyan("How to fix:"));
      for (const [i, step] of solution.steps.entries()) {
        content.push(`  ${dim(`${i + 1}.`)} ${step}`);
      }
    }

    if (solution.example) {
      content.push("");
      content.push(dim("Example:"));
      for (const line of solution.example.split("\n")) {
        content.push(`  ${dim(line)}`);
      }
    }

    if (solution.docs) {
      content.push("");
      content.push(dim("Learn more: ") + cyan(solution.docs));
    }
  } else {
    content.push("");
    content.push(dim("For help, run: ") + cyan("veryfront doctor"));
  }

  return box(content.join("\n"), {
    style: "rounded" as BorderStyle,
    title: "Error",
    titleColor: errorColor,
    borderColor: errorColor,
    paddingX: 2,
    paddingY: 1,
  });
}

/**
 * Format error with plain text (existing behavior)
 */
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

    return output.join("\n");
  }

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

  return output.join("\n");
}
