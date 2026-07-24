import {
  createCanonicalVeryfrontApiTransport,
  type TransportRequestInit,
  type TransportRetryConfig,
} from "../veryfront-api-transport.ts";

export type RetryConfig = TransportRetryConfig;
export type RequestOptions = TransportRequestInit;

/** Backward-compat alias; prefer holding a transport instance directly. */
export function requestWithRetry(
  url: string,
  apiToken: string,
  retryConfig: RetryConfig,
  options: RequestOptions = {},
): Promise<unknown> {
  const { origin } = new URL(url);
  return createCanonicalVeryfrontApiTransport(origin, () => apiToken, retryConfig)
    .request(url, options);
}
