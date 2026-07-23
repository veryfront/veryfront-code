/**
 * CLI Error Boundary Middleware
 *
 * Unified error catch → format → exit pipeline for CLI boundaries.
 * Formats errors with slug-based identity for better diagnostics.
 *
 * @module errors/middleware/cli-error-boundary
 */

import { trace } from "#veryfront/observability/tracing/api-shim.ts";
import { VeryfrontError } from "../types.ts";
import { UNKNOWN_ERROR } from "../error-registry.ts";
import { getErrorMessage } from "../veryfront-error.ts";
import { recordErrorCount } from "#veryfront/observability/metrics/index.ts";
import { attachErrorToActiveSpan } from "../tracing.ts";
import { isProduction } from "#veryfront/platform/environment.ts";
import { sanitizeErrorText } from "../sanitization.ts";
import { safeErrorStack, snapshotVeryfrontError } from "../error-snapshot.ts";

function unknownErrorDetail(error: unknown): string {
  return sanitizeErrorText(getErrorMessage(error), 16_000);
}

function safelyRecordError(error: VeryfrontError): void {
  const snapshot = snapshotVeryfrontError(error);
  try {
    recordErrorCount({
      slug: snapshot.slug,
      category: snapshot.category,
      status: String(snapshot.status),
    });
  } catch {
    // Observability must not replace the application failure.
  }
}

function resolveExitCode(
  resolver: ((error: unknown, vfError: VeryfrontError) => number) | undefined,
  error: unknown,
  vfError: VeryfrontError,
): number {
  if (!resolver) return 1;
  try {
    const code = resolver(error, vfError);
    return Number.isInteger(code) && code >= 1 && code <= 255 ? code : 1;
  } catch {
    return 1;
  }
}

/** Callbacks that customize asynchronous CLI error reporting and exit status. */
export interface CLIErrorBoundaryOptions {
  /** Report the failure before the command exits. */
  readonly onError?: (error: unknown, vfError: VeryfrontError) => void | Promise<void>;
  /** Resolve a non-zero process exit code for the failure. */
  readonly getExitCode?: (error: unknown, vfError: VeryfrontError) => number;
}

interface CLIErrorBoundarySnapshot {
  onError?: (error: unknown, vfError: VeryfrontError) => void | Promise<void>;
  getExitCode?: (error: unknown, vfError: VeryfrontError) => number;
}

function snapshotBoundaryOptions(
  options: CLIErrorBoundaryOptions,
): CLIErrorBoundarySnapshot {
  try {
    if (!options || typeof options !== "object") throw new TypeError();
    const onError = options.onError;
    const getExitCode = options.getExitCode;
    if (onError !== undefined && typeof onError !== "function") throw new TypeError();
    if (getExitCode !== undefined && typeof getExitCode !== "function") throw new TypeError();
    return {
      onError: onError === undefined
        ? undefined
        : (error, vfError) => onError.call(options, error, vfError),
      getExitCode: getExitCode === undefined
        ? undefined
        : (error, vfError) => getExitCode.call(options, error, vfError),
    };
  } catch {
    throw new TypeError("Invalid CLI error boundary options");
  }
}

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
  const snapshot = snapshotVeryfrontError(error);
  const lines: string[] = [];

  // Header: [slug] title
  lines.push("");
  lines.push(
    colors.red(colors.bold(`✖ [${snapshot.slug}]`)) + " " + colors.bold(snapshot.title),
  );
  lines.push("");

  // Detail
  if (snapshot.detail) {
    lines.push(colors.dim("  Detail: ") + snapshot.detail);
  }

  // Suggestion
  if (snapshot.suggestion) {
    lines.push(
      colors.yellow("  💡 Suggestion: ") + snapshot.suggestion,
    );
  }

  // Docs link
  lines.push(
    colors.dim("  📚 Docs: ") +
      colors.cyan(`https://veryfront.com/docs/errors/${snapshot.slug}`),
  );

  // Stack trace in dev mode
  const stack = isDevelopment() ? safeErrorStack(error) : undefined;
  if (stack) {
    lines.push("");
    lines.push(colors.dim("  Stack trace:"));
    const stackLines = stack.split("\n").slice(1, 6); // First 5 lines
    for (const line of stackLines) {
      lines.push(colors.dim(`    ${sanitizeErrorText(line.trim(), 2_048)}`));
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
  const unknownError = UNKNOWN_ERROR.create({
    detail: unknownErrorDetail(error),
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
  options: CLIErrorBoundaryOptions = {},
): Promise<void> {
  if (typeof handler !== "function") throw new TypeError("handler must be a function");
  const snapshot = snapshotBoundaryOptions(options);
  try {
    await handler();
  } catch (error) {
    // Convert error to VeryfrontError
    const vfError = error instanceof VeryfrontError ? error : UNKNOWN_ERROR.create({
      detail: unknownErrorDetail(error),
      cause: error instanceof Error ? error : undefined,
    });

    safelyRecordError(vfError);

    // Attach error to active OpenTelemetry span
    attachErrorToActiveSpan(vfError, trace);

    const exitCode = resolveExitCode(snapshot.getExitCode, error, vfError);
    try {
      if (snapshot.onError) {
        await snapshot.onError(error, vfError);
      } else {
        console.error(formatCLIError(error));
      }
    } catch {
      try {
        console.error(formatCLIError(vfError));
      } catch {
        // Reporting must not prevent the boundary from exiting.
      }
    }
    exit(exitCode);
  }
}

/**
 * Synchronous version of CLI error boundary
 */
export function cliErrorBoundarySync(
  handler: () => void,
): void {
  if (typeof handler !== "function") throw new TypeError("handler must be a function");
  try {
    handler();
  } catch (error) {
    // Convert error to VeryfrontError
    const vfError = error instanceof VeryfrontError ? error : UNKNOWN_ERROR.create({
      detail: unknownErrorDetail(error),
      cause: error instanceof Error ? error : undefined,
    });

    safelyRecordError(vfError);

    // Attach error to active OpenTelemetry span
    attachErrorToActiveSpan(vfError, trace);

    try {
      console.error(formatCLIError(error));
    } catch {
      // Reporting must not prevent the boundary from exiting.
    }
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
