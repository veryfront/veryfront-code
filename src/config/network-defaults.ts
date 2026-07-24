import { LOCALHOST } from "#veryfront/platform/compat/constants.ts";
export { LOCALHOST };

export const HTTP_DEFAULTS = Object.freeze(
  {
    PORT: 3000,
    HOST: "localhost",
    PROD_HOST: "0.0.0.0",
  } as const,
);

export const REDIS_DEFAULTS = Object.freeze(
  {
    URL: "redis://127.0.0.1:6379",
    PORT: 6379,
    HOST: "127.0.0.1",
  } as const,
);

export const DEV_LOCALHOST_ORIGINS = Object.freeze(
  [
    "http://localhost",
    "http://127.0.0.1",
    "https://localhost",
    "https://127.0.0.1",
  ] as const,
);

export const DEV_LOCALHOST_CSP = Object.freeze(
  {
    WS: "ws://localhost:* wss://localhost:*",
    HTTP: "http://localhost",
  } as const,
);

export const LOCALHOST_URLS = Object.freeze(
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
  return `${protocol}://${host}:${port}`;
}

export function buildLocalhostUrl(
  port: number,
  protocol: "http" | "https" = "http",
): string {
  return buildUrl(LOCALHOST.HOSTNAME, port, protocol);
}

export function buildIpv4Url(
  port: number,
  protocol: "http" | "https" = "http",
): string {
  return buildUrl(LOCALHOST.IPV4, port, protocol);
}
