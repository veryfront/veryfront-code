import { bold, cyan, dim, red, yellow } from "../../platform/compat/console/index.js";
import { box } from "../../cli/ui/index.js";
import { ERROR_SOLUTIONS } from "./error-catalog.js";
import { identifyError } from "./error-identifier.js";

const errorColor = "\x1b[38;2;239;68;68m"; // Red

/**
 * Format error as a polished box with solution
 */
export function formatErrorBox(error: Error): string {
  const errorKey = identifyError(error);
  const solution = ERROR_SOLUTIONS[errorKey];

  const content: string[] = [error.message];

  if (!solution) {
    content.push("", dim("For help, run: ") + cyan("veryfront doctor"));

    return box(content.join("\n"), {
      style: "rounded",
      title: "Error",
      titleColor: errorColor,
      borderColor: errorColor,
      paddingX: 2,
      paddingY: 1,
    });
  }

  if (solution.message) {
    content.push("", dim(solution.message));
  }

  if (solution.steps?.length) {
    content.push("", cyan("How to fix:"));
    for (const [i, step] of solution.steps.entries()) {
      content.push(`  ${dim(`${i + 1}.`)} ${step}`);
    }
  }

  if (solution.example) {
    content.push("", dim("Example:"));
    for (const line of solution.example.split("\n")) {
      content.push(`  ${dim(line)}`);
    }
  }

  if (solution.docs) {
    content.push("", dim("Learn more: ") + cyan(solution.docs));
  }

  return box(content.join("\n"), {
    style: "rounded",
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
  const output: string[] = [
    "",
    red(bold("✖ Error: ")) + bold(error.message),
    "",
  ];

  const errorKey = identifyError(error);
  const solution = ERROR_SOLUTIONS[errorKey];

  if (solution) {
    if (solution.message) {
      output.push(yellow("Problem: ") + solution.message, "");
    }

    if (solution.steps?.length) {
      output.push(cyan("How to fix:"));
      for (const [i, step] of solution.steps.entries()) {
        output.push(`  ${dim(`${i + 1}.`)} ${step}`);
      }
      output.push("");
    }

    if (solution.example) {
      output.push(cyan("Example:"), "");
      for (const line of solution.example.split("\n")) {
        output.push(`  ${dim(line)}`);
      }
      output.push("");
    }

    if (solution.docs) {
      output.push(dim("Learn more: ") + cyan(solution.docs), "");
    }

    return output.join("\n");
  }

  if (error.stack) {
    output.push(yellow("Stack trace:"));
    for (const line of error.stack.split("\n").slice(1, 4)) {
      output.push(dim(`  ${line.trim()}`));
    }
    output.push("");
  }

  output.push(dim("For help, run: ") + cyan("veryfront doctor"), "");

  return output.join("\n");
}
