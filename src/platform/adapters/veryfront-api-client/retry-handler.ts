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
  outboundPolicy?: {
    authorizeUrl?: (url: URL) => void | Promise<void>;
  },
): Promise<unknown> {
  const { origin } = new URL(url);
  return createCanonicalVeryfrontApiTransport(origin, () => apiToken, retryConfig, outboundPolicy)
    .request(url, options);
}
