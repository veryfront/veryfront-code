/**
 * Canonical Veryfront API transport for the Runs SDK, configured with one options object.
 */
import {
  createCanonicalVeryfrontApiTransport,
  type TransportRetryConfig,
  type VeryfrontApiTransport,
} from "#veryfront/platform/adapters/veryfront-api-transport.ts";

/** Options for {@link createRunsApiTransport}. */
export interface RunsApiTransportOptions {
  /** API origin, for example `https://api.veryfront.com`. */
  baseUrl: string;
  /** Returns the credential for each request: a user token, a run execution token or a project API key. */
  getToken: () => string;
  /**
   * How the credential is sent: `bearer` (default) as `Authorization: Bearer`, `api-key` as
   * `X-API-Key`, or `none` for anonymous operations.
   */
  authMode?: "bearer" | "api-key" | "none";
  /** Retries after a failed attempt. Defaults to two retries with 100 ms to 1 s backoff. */
  retry?: TransportRetryConfig;
}

const DEFAULT_RUNS_API_RETRY: TransportRetryConfig = {
  maxRetries: 2,
  initialDelay: 100,
  maxDelay: 1_000,
};

/**
 * Create the canonical Veryfront API transport for `createRunsSdk`. It owns the origin,
 * credentials, retries, response body limits and telemetry of every SDK request.
 */
export function createRunsApiTransport(
  options: RunsApiTransportOptions,
): VeryfrontApiTransport<unknown> {
  return createCanonicalVeryfrontApiTransport(
    options.baseUrl,
    options.getToken,
    options.retry ?? DEFAULT_RUNS_API_RETRY,
    undefined,
    options.authMode,
  );
}
