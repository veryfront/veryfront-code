import { bold, cyan, dim, red, yellow } from "#veryfront/compat/console";
import { box } from "#veryfront/utils/box.ts";
import { isProduction } from "#veryfront/platform/environment.ts";
import { ERROR_SOLUTIONS } from "./error-catalog.ts";
import { identifyError } from "./error-identifier.ts";
import {
  limitRenderedErrorOutput,
  sanitizeTerminalDiagnosticText,
  snapshotErrorForBoundary,
} from "../safe-diagnostics.ts";
import { getErrorMessage, snapshotErrorAsError } from "../veryfront-error.ts";

const errorColor = "\x1b[38;2;239;68;68m"; // Red

function getSolution(errorKey: string): (typeof ERROR_SOLUTIONS)[string] | undefined {
  return Object.hasOwn(ERROR_SOLUTIONS, errorKey) ? ERROR_SOLUTIONS[errorKey] : undefined;
}

function buildSolutionDetailsLines(
  solution: (typeof ERROR_SOLUTIONS)[string],
  options?: {
    exampleLabel?: string;
  },
): string[] {
  const lines: string[] = [];

  if (solution.steps?.length) {
    lines.push("", cyan("How to fix:"));
    for (const [i, step] of solution.steps.entries()) {
      lines.push(`  ${dim(`${i + 1}.`)} ${step}`);
    }
  }

  if (solution.example) {
    lines.push("", options?.exampleLabel ?? cyan("Example:"));
    for (const line of solution.example.split("\n")) {
      lines.push(`  ${dim(line)}`);
    }
  }

  if (solution.docs) {
    lines.push("", dim("Learn more: ") + cyan(solution.docs));
  }

  return lines;
}

/**
 * Format error as a polished box with solution
 */
export function formatErrorBox(error: Error): string {
  const stableError = snapshotErrorAsError(error);
  const errorKey = identifyError(stableError);
  const solution = getSolution(errorKey);

  const content: string[] = [
    sanitizeTerminalDiagnosticText(getErrorMessage(stableError)),
  ];

  if (!solution) {
    content.push("", dim("For help, run: ") + cyan("veryfront doctor"));
  } else {
    if (solution.message) {
      content.push("", dim(solution.message));
    }
    content.push(...buildSolutionDetailsLines(solution, { exampleLabel: dim("Example:") }));
  }

  return limitRenderedErrorOutput(
    box(content.join("\n"), {
      style: "rounded",
      title: "Error",
      titleColor: errorColor,
      borderColor: errorColor,
      paddingX: 2,
      paddingY: 1,
    }),
  );
}

/**
 * Format error with plain text (existing behavior)
 */
export function formatUserError(error: Error): string {
  const stableError = snapshotErrorAsError(error);
  const message = sanitizeTerminalDiagnosticText(getErrorMessage(stableError));
  const output: string[] = ["", red(bold("✖ Error: ")) + bold(message), ""];

  const errorKey = identifyError(stableError);
  const solution = getSolution(errorKey);

  if (solution) {
    if (solution.message) {
      output.push(yellow("Problem: ") + solution.message);
    }
    output.push(...buildSolutionDetailsLines(solution), "");
    return limitRenderedErrorOutput(output.join("\n"));
  }

  const stack = snapshotErrorForBoundary(stableError).stack;
  if (!isProduction() && stack) {
    output.push(yellow("Stack trace:"));
    for (const line of stack.split(/\r\n?|\n/).slice(1, 4)) {
      output.push(dim(`  ${sanitizeTerminalDiagnosticText(line).trim()}`));
    }
    output.push("");
  }

  output.push(dim("For help, run: ") + cyan("veryfront doctor"), "");

  return limitRenderedErrorOutput(output.join("\n"));
}
