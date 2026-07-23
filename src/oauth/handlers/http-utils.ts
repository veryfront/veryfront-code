import type { EnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { isLoopbackHostname } from "../validation.ts";

const LOCAL_DEVELOPMENT_APP_URL = "http://localhost:3000";
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
} as const;

function parseAppUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw INVALID_ARGUMENT.create({ detail: "OAuth application URL is invalid" });
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username || url.password || url.search || url.hash
  ) {
    throw INVALID_ARGUMENT.create({
      detail:
        "OAuth application URL must use HTTP or HTTPS and must not contain credentials, a query, or a fragment",
    });
  }
  if (url.protocol !== "https:" && !isLoopbackHostname(url.hostname)) {
    throw INVALID_ARGUMENT.create({
      detail: "OAuth application URL must use HTTPS unless it targets a loopback host",
    });
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

export function resolveOAuthAppUrl(
  baseUrl: string | undefined,
  env: EnvironmentConfig,
): string {
  const production = env.nodeEnv === "production" || env.veryfrontEnv === "production";
  const value = baseUrl ?? env.appUrl;
  if (!value) {
    if (production) {
      throw INVALID_ARGUMENT.create({
        detail: "OAuth callback base URL is not configured",
      });
    }
    return LOCAL_DEVELOPMENT_APP_URL;
  }
  return parseAppUrl(value).toString().replace(/\/$/, "");
}

export function createOAuthCallbackUri(appUrl: string, serviceId: string): string {
  const callback = new URL(appUrl);
  callback.pathname = `${callback.pathname.replace(/\/+$/, "")}/api/auth/${
    encodeURIComponent(serviceId)
  }/callback`;
  callback.search = "";
  callback.hash = "";
  return callback.toString();
}

export function assertApplicationRedirectPath(path: string, name: string): void {
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(path) || path.startsWith("//")) {
    throw INVALID_ARGUMENT.create({
      detail: `${name} must resolve to the same origin as the application`,
    });
  }
  let target: URL;
  try {
    target = new URL(path, "https://oauth-redirect.invalid/");
  } catch {
    throw INVALID_ARGUMENT.create({ detail: `${name} must be a valid application path` });
  }
  if (target.origin !== "https://oauth-redirect.invalid") {
    throw INVALID_ARGUMENT.create({
      detail: `${name} must resolve to the same origin as the application`,
    });
  }
}

export function resolveApplicationRedirect(appUrl: string, path: string): URL {
  const target = new URL(path, appUrl);
  if (target.origin !== new URL(appUrl).origin) {
    throw INVALID_ARGUMENT.create({
      detail: "OAuth redirect must resolve to the same origin as the application",
    });
  }
  return target;
}

export function createNoStoreRedirect(url: string | URL): Response {
  return new Response(null, {
    status: 302,
    headers: { ...NO_STORE_HEADERS, Location: url.toString() },
  });
}

export function createNoStoreJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

export function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

export function normalizeOAuthErrorCode(value: string): string {
  return /^[A-Za-z0-9._~-]{1,128}$/.test(value) ? value : "provider_error";
}
