/**
 * The largest final output a run may store (veryfront/veryfront-issue-inbox#2113): the UTF-8
 * byte length of the run output serialized as JSON. Exactly this many bytes is allowed. The
 * API (veryfront-api) enforces the same constant at the terminal write, which is authoritative;
 * the runtime checks first so an oversized result never crosses the wire.
 *
 * @module task/run-output-limit
 */

import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";

/** The run output limit in bytes (1 MiB). */
export const RUN_OUTPUT_LIMIT_BYTES = 1_048_576;

/** The error code of a run whose final output is over {@link RUN_OUTPUT_LIMIT_BYTES}. */
export const OUTPUT_TOO_LARGE_CODE = "OUTPUT_TOO_LARGE";

/** The failure a run output over the limit is reported with. */
export interface RunOutputTooLargeError {
  code: typeof OUTPUT_TOO_LARGE_CODE;
  message: string;
  detail: { size_bytes: number; limit_bytes: number };
}

// Project code runs in this realm and can replace mutable globals. Capture the
// serialization capabilities before any project task executes. `utf8ByteLength`
// captures its own intrinsics at load and counts bytes without an encoded copy.
const capturedJsonStringify = JSON.stringify.bind(JSON);
const capturedJsonParse = JSON.parse.bind(JSON);

/** JSON serialization captured at the runtime trust boundary. */
export function serializeRunOutput(output: unknown): string | undefined {
  return capturedJsonStringify(output);
}

/** Parses a captured serialization without consulting mutable project globals. */
export function parseSerializedRunOutput(serialized: string): unknown {
  return capturedJsonParse(serialized) as unknown;
}

/**
 * UTF-8 bytes of the JSON serialization. A value JSON cannot represent (`undefined`) is
 * stored as `null`, so it measures as `null`.
 */
export function measureRunOutputBytes(output: unknown): number {
  return measureSerializedRunOutputBytes(serializeRunOutput(output));
}

/** {@link measureRunOutputBytes} for an output already serialized with `JSON.stringify`. */
export function measureSerializedRunOutputBytes(serialized: string | undefined): number {
  return utf8ByteLength(serialized ?? "null");
}

/** `null` when the output may be sent and stored, else the error to fail the run with. Never truncates. */
export function checkRunOutputLimit(output: unknown): RunOutputTooLargeError | null {
  return checkRunOutputBytes(measureRunOutputBytes(output));
}

/** {@link checkRunOutputLimit} for an output already measured with {@link measureRunOutputBytes}. */
export function checkRunOutputBytes(sizeBytes: number): RunOutputTooLargeError | null {
  if (sizeBytes <= RUN_OUTPUT_LIMIT_BYTES) return null;
  return {
    code: OUTPUT_TOO_LARGE_CODE,
    message: `Run output is ${sizeBytes} bytes, over the limit of ${RUN_OUTPUT_LIMIT_BYTES} bytes`,
    detail: { size_bytes: sizeBytes, limit_bytes: RUN_OUTPUT_LIMIT_BYTES },
  };
}
