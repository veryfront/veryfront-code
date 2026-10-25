/**
 * Public factory functions for creating errors with trusted WeakMap
 * classification. These are the only public API for recording stream protocol
 * classifications — the raw WeakMap writer is internal.
 *
 * Deliberate invocation of a public SDK factory is allowed (same pattern as
 * `buildProviderError`); this is not a sandbox against same-process code.
 * The exact classification allowlist in telemetry still gates which values
 * reach logs; no arbitrary payloads are logged.
 *
 * Separated from `stream-protocol-classification.ts` to avoid a module
 * boundary cycle: that file is imported by `telemetry-error.ts` which
 * participates in a cycle through `provider-http.ts`.
 */

import { recordStreamProtocolClassification } from "./stream-protocol-classification.ts";
import { ProviderStreamProtocolError } from "./provider-http.ts";

/**
 * Create a `ProviderStreamProtocolError` with a trusted WeakMap classification.
 *
 * The factory constructs the error internally and records the classification
 * before returning it. Callers cannot annotate an existing application error.
 */
export function createClassifiedProviderStreamProtocolError(
  options: {
    provider: "anthropic";
    status: number;
    message: string;
    retryable: boolean;
    cause?: unknown;
  },
  classification: string,
): ProviderStreamProtocolError {
  const error = new ProviderStreamProtocolError(options);
  recordStreamProtocolClassification(error, classification);
  return error;
}

/**
 * Create a native `RangeError` with a trusted WeakMap classification.
 *
 * Used by parser limit exits (SSE size, partial_json retention) that throw
 * `RangeError` instead of `ProviderStreamProtocolError`.
 */
export function createClassifiedStreamRangeError(
  classification: string,
): RangeError {
  const error = new RangeError(classification);
  recordStreamProtocolClassification(error, classification);
  return error;
}
