import { DEFAULT_PORT, LOCALHOST } from "#veryfront/platform/compat/constants.ts";
export { LOCALHOST };

/** Default host and port values for HTTP servers. */
export const HTTP_DEFAULTS: Readonly<{
  PORT: typeof DEFAULT_PORT;
  HOST: typeof LOCALHOST.HOSTNAME;
  PROD_HOST: "0.0.0.0";
}> = Object.freeze(
  {
    PORT: DEFAULT_PORT,
    HOST: LOCALHOST.HOSTNAME,
    PROD_HOST: "0.0.0.0",
  } as const,
);

/** Default local Redis connection values. */
export const REDIS_DEFAULTS: Readonly<{
  URL: "redis://127.0.0.1:6379";
  PORT: 6379;
  HOST: "127.0.0.1";
}> = Object.freeze(
  {
    URL: "redis://127.0.0.1:6379",
    PORT: 6379,
    HOST: "127.0.0.1",
  } as const,
);

/** Local origins allowed by development-only policies. */
export const DEV_LOCALHOST_ORIGINS: readonly [
  "http://localhost",
  "http://127.0.0.1",
  "https://localhost",
  "https://127.0.0.1",
] = Object.freeze(
  [
    "http://localhost",
    "http://127.0.0.1",
    "https://localhost",
    "https://127.0.0.1",
  ] as const,
);

/** Local connection sources used by development Content Security Policy. */
export const DEV_LOCALHOST_CSP: Readonly<{
  WS: "ws://localhost:* wss://localhost:*";
  HTTP: "http://localhost";
}> = Object.freeze(
  {
    WS: "ws://localhost:* wss://localhost:*",
    HTTP: "http://localhost",
  } as const,
);

/** Canonical loopback URLs without ports. */
export const LOCALHOST_URLS: Readonly<{
  HTTP: "http://localhost";
  HTTPS: "https://localhost";
  HTTP_IPV4: "http://127.0.0.1";
  HTTPS_IPV4: "https://127.0.0.1";
}> = Object.freeze(
  {
    HTTP: "http://localhost",
    HTTPS: "https://localhost",
    HTTP_IPV4: "http://127.0.0.1",
    HTTPS_IPV4: "https://127.0.0.1",
  } as const,
);

function buildUrl(
  host: string,
  port: number,
  protocol: "http" | "https" = "http",
): string {
  if (protocol !== "http" && protocol !== "https") {
    throw new TypeError('protocol must be "http" or "https"');
  }
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError("port must be an integer between 1 and 65535");
  }
  return `${protocol}://${host}:${port}`;
}

/** Build a validated localhost URL for the selected protocol and port. */
export function buildLocalhostUrl(
  port: number,
  protocol: "http" | "https" = "http",
): string {
  return buildUrl(LOCALHOST.HOSTNAME, port, protocol);
}

/** Build a validated IPv4 loopback URL for the selected protocol and port. */
export function buildIpv4Url(
  port: number,
  protocol: "http" | "https" = "http",
): string {
  return buildUrl(LOCALHOST.IPV4, port, protocol);
}
