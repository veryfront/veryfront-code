/**
 * CLI Error Boundary Middleware
 *
 * Unified error catch → format → exit pipeline for CLI boundaries.
 * Formats errors with slug-based identity for better diagnostics.
 *
 * @module errors/middleware/cli-error-boundary
 */

import { trace } from "@opentelemetry/api";
import { VeryfrontError } from "../types.ts";
import { UNKNOWN_ERROR } from "../error-registry.ts";
import { getErrorMessage } from "../veryfront-error.ts";
import { recordErrorCount } from "#veryfront/observability/metrics/index.ts";
import { attachErrorToActiveSpan } from "../tracing.ts";
import { isProduction } from "#veryfront/build/config/environment.ts";

/**
 * Color formatting functions (compatible with CLI colors)
 * These should match the CLI's color utilities
 */
interface ColorFormatter {
  red: (text: string) => string;
  yellow: (text: string) => string;
  cyan: (text: string) => string;
  dim: (text: string) => string;
  bold: (text: string) => string;
}

/**
 * Check if output is a TTY (supports colors)
 */
function isTTY(): boolean {
  const deno = globalThis as {
    Deno?: {
      stdout?: { isTerminal?: () => boolean };
    };
    process?: {
      stdout?: { isTTY?: boolean };
    };
  };

  if (typeof deno.Deno?.stdout?.isTerminal === "function") {
    return deno.Deno.stdout.isTerminal();
  }

  return deno.process?.stdout?.isTTY ?? false;
}

/**
 * Check if running in development mode
 */
function isDevelopment(): boolean {
  return !isProduction();
}

/**
 * Simple color formatters (no-op if not TTY)
 */
function createColorFormatters(): ColorFormatter {
  const noColor = !isTTY();

  if (noColor) {
    const identity = (text: string) => text;
    return {
      red: identity,
      yellow: identity,
      cyan: identity,
      dim: identity,
      bold: identity,
    };
  }

  return {
    red: (text: string) => `\x1b[31m${text}\x1b[0m`,
    yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
    cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
    dim: (text: string) => `\x1b[2m${text}\x1b[0m`,
    bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
  };
}

/**
 * Format a VeryfrontError for CLI output
 *
 * Format: [slug] title
 *   Detail: {detail}
 *   Suggestion: {suggestion}
 *   Docs: https://veryfront.com/docs/errors/{slug}
 *   (Stack trace in dev mode)
 */
function formatVeryfrontError(error: VeryfrontError, colors: ColorFormatter): string {
  const lines: string[] = [];

  // Header: [slug] title
  lines.push("");
  lines.push(
    colors.red(colors.bold(`✖ [${error.slug}]`)) + " " + colors.bold(error.title),
  );
  lines.push("");

  // Detail
  if (error.detail) {
    lines.push(colors.dim("  Detail: ") + error.detail);
  }

  // Suggestion
  if (error.suggestion) {
    lines.push(colors.yellow("  💡 Suggestion: ") + error.suggestion);
  }

  // Docs link
  lines.push(colors.dim("  📚 Docs: ") + colors.cyan(error.getDocsUrl()));

  // Stack trace in dev mode
  if (isDevelopment() && error.stack) {
    lines.push("");
    lines.push(colors.dim("  Stack trace:"));
    const stackLines = error.stack.split("\n").slice(1, 6); // First 5 lines
    for (const line of stackLines) {
      lines.push(colors.dim(`    ${line.trim()}`));
    }
  }

  lines.push("");

  return lines.join("\n");
}

/**
 * Format any error for CLI output
 */
export function formatCLIError(error: unknown): string {
  const colors = createColorFormatters();

  // Handle VeryfrontError
  if (error instanceof VeryfrontError) {
    return formatVeryfrontError(error, colors);
  }

  // Wrap unknown errors
  const message = getErrorMessage(error);
  const unknownError = UNKNOWN_ERROR.create({
    detail: message,
    cause: error instanceof Error ? error : undefined,
  });

  return formatVeryfrontError(unknownError, colors);
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
): Promise<void> {
  try {
    await handler();
  } catch (error) {
    // Convert error to VeryfrontError
    const vfError = error instanceof VeryfrontError ? error : UNKNOWN_ERROR.create({
      detail: getErrorMessage(error),
      cause: error instanceof Error ? error : undefined,
    });

    // Record error metrics
    recordErrorCount({
      slug: vfError.slug,
      category: vfError.category,
      status: String(vfError.status),
    });

    // Attach error to active OpenTelemetry span
    attachErrorToActiveSpan(vfError, trace);

    console.log(formatCLIError(error));
    exit(1);
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
    const vfError = error instanceof VeryfrontError ? error : UNKNOWN_ERROR.create({
      detail: getErrorMessage(error),
      cause: error instanceof Error ? error : undefined,
    });

    // Record error metrics
    recordErrorCount({
      slug: vfError.slug,
      category: vfError.category,
      status: String(vfError.status),
    });

    // Attach error to active OpenTelemetry span
    attachErrorToActiveSpan(vfError, trace);

    console.log(formatCLIError(error));
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
