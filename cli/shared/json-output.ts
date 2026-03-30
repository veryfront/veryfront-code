/**
 * Shared JSON output utilities for CLI commands
 *
 * Provides consistent structured output for agent consumption.
 * All commands use the same envelope format.
 *
 * @module cli/shared/json-output
 */

/** Whether the current command should output JSON */
let _jsonMode = false;

/** Whether the current command should write output to a file */
let _outputPath: string | null = null;

export function setJsonMode(enabled: boolean): void {
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
    slug: string;
    message: string;
    context?: Record<string, unknown>;
  };
}

export type JsonEnvelope<T = unknown> = SuccessEnvelope<T> | ErrorEnvelope;

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
  error: { code: string; slug: string; message: string; context?: Record<string, unknown> },
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
    await Deno.mkdir(dirname(_outputPath), { recursive: true });
    await Deno.writeTextFile(_outputPath, json);
  }
}

/**
 * Write a single NDJSON line to stdout.
 * Used for streaming output from long-running commands.
 */
export function streamJsonLine(event: Record<string, unknown>): void {
  console.log(JSON.stringify(event));
}
