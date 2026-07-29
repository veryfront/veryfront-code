/**
 * CLI Error Boundary Middleware
 *
 * Unified error catch → format → exit pipeline for CLI boundaries.
 * Formats errors with slug-based identity for better diagnostics.
 *
 * @module errors/middleware/cli-error-boundary
 */

import { getEnv, isStdoutTTY } from "#veryfront/platform/compat/process.ts";
import { VeryfrontError } from "../types.ts";
import {
  buildErrorDocsUrl,
  limitRenderedErrorOutput,
  sanitizeTerminalDiagnosticText,
  snapshotErrorForBoundary,
} from "../safe-diagnostics.ts";
import { observeBoundaryErrorBestEffort } from "./boundary-observability.ts";
import { detachBoundaryError } from "./wrap-unknown.ts";

/**
 * Color formatting functions (compatible with CLI colors)
 * These should match the CLI's color utilities
 */
interface ColorFormatter {
  red: (text: string) => string;
  dim: (text: string) => string;
}

function shouldUseDefaultColor(): boolean {
  const forceColor = getEnv("FORCE_COLOR");
  if (forceColor !== undefined) return forceColor !== "0";
  if (getEnv("NO_COLOR") !== undefined || getEnv("TERM") === "dumb") return false;
  return isStdoutTTY();
}

function createColorFormatters(useColor: boolean): ColorFormatter {
  if (!useColor) {
    const identity = (text: string) => text;
    return {
      red: identity,
      dim: identity,
    };
  }

  return {
    red: (text: string) => `\x1b[31m${text}\x1b[0m`,
    dim: (text: string) => `\x1b[2m${text}\x1b[0m`,
  };
}

export interface CLIErrorFormatOptions {
  color?: boolean;
  verbose?: boolean;
}

function formatVeryfrontError(
  error: unknown,
  colors: ColorFormatter,
  options: CLIErrorFormatOptions,
): string {
  const snapshot = snapshotErrorForBoundary(error);
  const slug = sanitizeTerminalDiagnosticText(snapshot.slug);
  const primaryMessage = sanitizeTerminalDiagnosticText(
    snapshot.detail ?? snapshot.title,
  );
  const lines = ["", `${colors.red("✗")} ${primaryMessage}`];

  if (snapshot.slug === "unknown-error") {
    lines.push(colors.dim("  Run with --verbose for details"));
  } else if (snapshot.suggestion) {
    lines.push(
      colors.dim(`  ${sanitizeTerminalDiagnosticText(snapshot.suggestion)}`),
    );
  }

  if (options.verbose) {
    lines.push("");
    lines.push(colors.dim(`  Code: ${slug}`));
    lines.push(colors.dim(`  Docs: ${buildErrorDocsUrl(snapshot.slug)}`));
    if (snapshot.stack) {
      lines.push(colors.dim("  Stack trace:"));
      for (const line of snapshot.stack.split(/\r\n?|\n/).slice(1, 6)) {
        lines.push(
          colors.dim(
            `    ${sanitizeTerminalDiagnosticText(line).trim()}`,
          ),
        );
      }
    }
  }

  lines.push("");

  return limitRenderedErrorOutput(lines.join("\n"));
}

/**
 * Format any error for CLI output
 */
export function formatCLIError(
  error: unknown,
  options: CLIErrorFormatOptions = {},
): string {
  const colors = createColorFormatters(options.color ?? shouldUseDefaultColor());
  return formatVeryfrontError(error, colors, options);
}

/**
 * CLI error boundary - wraps a handler function and catches errors
 *
 * Usage:
 * ```typescript
 * export async function main() {
 *   await cliErrorBoundary(async () => {
 *     // Your CLI logic here
 *   });
 * }
 * ```
 */
export async function cliErrorBoundary(
  handler: () => Promise<void>,
  options: {
    onError?: (error: unknown, vfError: VeryfrontError) => void | Promise<void>;
    getExitCode?: (error: unknown, vfError: VeryfrontError) => number;
  } = {},
): Promise<void> {
  try {
    await handler();
  } catch (error) {
    // Convert error to VeryfrontError
    const vfError = detachBoundaryError(error);
    observeBoundaryErrorBestEffort(vfError);

    if (options.onError) {
      await options.onError(error, vfError);
    } else {
      console.log(formatCLIError(vfError));
    }
    exit(options.getExitCode?.(error, vfError) ?? 1);
  }
}

/**
 * Synchronous version of CLI error boundary
 */
export function cliErrorBoundarySync(
  handler: () => void,
): void {
  try {
    handler();
  } catch (error) {
    // Convert error to VeryfrontError
    const vfError = detachBoundaryError(error);
    observeBoundaryErrorBestEffort(vfError);

    console.log(formatCLIError(vfError));
    exit(1);
  }
}

/**
 * Exit the process with a status code
 */
function exit(code: number): never {
  const runtime = globalThis as {
    Deno?: { exit?: (code: number) => never };
    process?: { exit?: (code: number) => never };
  };

  if (typeof runtime.Deno?.exit === "function") {
    runtime.Deno.exit(code);
  }

  if (typeof runtime.process?.exit === "function") {
    runtime.process.exit(code);
  }

  throw new Error(`Failed to exit with code ${code}`);
}
