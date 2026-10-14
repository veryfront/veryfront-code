/**
 * Canonical Veryfront API transport for the conversations SDK, configured with one options
 * object.
 */
import {
  createCanonicalVeryfrontApiTransport,
  type TransportRetryConfig,
  type VeryfrontApiTransport,
} from "#veryfront/platform/adapters/veryfront-api-transport.ts";

/** Options for {@link createConversationsApiTransport}. */
export interface ConversationsApiTransportOptions {
  /** API origin, for example `https://api.veryfront.com`. */
  baseUrl: string;
  /** Returns the credential for each request: a user token, a run execution token or a project API key. */
  getToken: () => string;
  /**
   * How the credential is sent: `bearer` (default) as `Authorization: Bearer`, or `api-key` as
   * `X-API-Key`.
   */
  authMode?: "bearer" | "api-key";
  /**
   * Retries after a failed attempt. Defaults to no retries: a retried write without an
   * idempotency key can store a message twice.
   */
  retry?: TransportRetryConfig;
}

const NO_RETRY: TransportRetryConfig = { maxRetries: 0, initialDelay: 0, maxDelay: 0 };

/**
 * Create the canonical Veryfront API transport for the conversations SDK. It owns the
 * origin, credentials, retries, response body limits and telemetry of every SDK request.
 */
export function createConversationsApiTransport(
  options: ConversationsApiTransportOptions,
): VeryfrontApiTransport<unknown> {
  return createCanonicalVeryfrontApiTransport(
    options.baseUrl,
    options.getToken,
    options.retry ?? NO_RETRY,
    undefined,
    options.authMode,
  );
}
