/**
 * Shared JSON output utilities for CLI commands
 *
 * Provides consistent structured output for agent consumption.
 * All commands use the same envelope format.
 *
 * @module cli/shared/json-output
 */

import { deleteEnv, getEnv, setEnv } from "#cli/process-env";
import { refreshLoggerConfig } from "#cli/logger-config";

/** Whether the current command should output JSON */
let _jsonMode = false;
let _previousLogLevel: string | undefined | null = null;

/** Whether the current command should write output to a file */
let _outputPath: string | null = null;

export function setJsonMode(enabled: boolean): void {
  if (enabled && !_jsonMode) {
    _previousLogLevel = getEnv("LOG_LEVEL");
    setEnv("LOG_LEVEL", "ERROR");
    refreshLoggerConfig();
  } else if (!enabled && _jsonMode) {
    if (_previousLogLevel === undefined) deleteEnv("LOG_LEVEL");
    else if (_previousLogLevel !== null) setEnv("LOG_LEVEL", _previousLogLevel);
    refreshLoggerConfig();
    _previousLogLevel = null;
  }

  _jsonMode = enabled;
}

export function isJsonMode(): boolean {
  return _jsonMode;
}

export function setOutputPath(path: string | null): void {
  _outputPath = path;
}

export function getOutputPath(): string | null {
  return _outputPath;
}

export interface SuccessEnvelope<T = unknown> {
  success: true;
  command: string;
  data: T;
  timing?: { duration_ms: number };
}

export interface ErrorEnvelope {
  success: false;
  command: string;
  error: {
    code: string;
    /** Stable classification consumers have keyed on since the first JSON release. */
    slug: string;
    /** Additive: the error registry slug, for consumers that need finer classification. */
    registrySlug?: string;
    message: string;
    context?: Record<string, unknown>;
  };
}

export type JsonEnvelope<T = unknown> = SuccessEnvelope<T> | ErrorEnvelope;

export interface StreamErrorDetails {
  code: string;
  slug: string;
  message: string;
}

export type StreamErrorResult = Record<string, unknown> & {
  type: "result";
  success: false;
  /** Legacy field kept as a string for existing NDJSON consumers. */
  error: string;
  /** Additive structured metadata for consumers that need stable error classification. */
  errorDetails: StreamErrorDetails;
};

export function createStreamErrorResult(error: StreamErrorDetails): StreamErrorResult {
  return {
    type: "result",
    success: false,
    error: error.message,
    errorDetails: error,
  };
}

export function createSuccessEnvelope<T>(
  command: string,
  data: T,
  timing?: { duration_ms: number },
): SuccessEnvelope<T> {
  const envelope: SuccessEnvelope<T> = { success: true, command, data };
  if (timing) envelope.timing = timing;
  return envelope;
}

export function createErrorEnvelope(
  command: string,
  error: ErrorEnvelope["error"],
): ErrorEnvelope {
  return { success: false, command, error };
}

export function formatJsonOutput(envelope: JsonEnvelope): string {
  return JSON.stringify(envelope, null, 2);
}

/**
 * Print JSON envelope to stdout.
 * If --output was specified, also write to file.
 */
export async function outputJson(envelope: JsonEnvelope): Promise<void> {
  const json = formatJsonOutput(envelope);
  console.log(json);

  if (_outputPath) {
    const { dirname } = await import("veryfront/platform/path");
    const { createFileSystem } = await import("veryfront/platform");
    const fs = createFileSystem();
    await fs.mkdir(dirname(_outputPath), { recursive: true });
    await fs.writeTextFile(_outputPath, json);
  }
}

/**
 * Write a single NDJSON line to stdout.
 * Used for streaming output from long-running commands.
 */
export function streamJsonLine(event: Record<string, unknown>): void {
  console.log(JSON.stringify(event));
}

/**
 * Pretty-print any value as indented JSON to stdout.
 */
export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
