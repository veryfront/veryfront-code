import type { EnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { isLoopbackHttpUrl } from "./url-validation.ts";

const LOCAL_DEVELOPMENT_APP_URL = "http://localhost:3000";

export const OAUTH_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
} as const;

function invalidApplicationUrl(detail: string): Error {
  return new Error(`Invalid OAuth application URL: ${detail}`);
}

/** Only explicit development/test environments may use local OAuth defaults. */
export function isExplicitLocalOAuthEnvironment(env: EnvironmentConfig): boolean {
  const localModes = new Set(["development", "test"]);
  return localModes.has(env.nodeEnv) && localModes.has(env.veryfrontEnv);
}

/** Resolve and validate the public web origin used by OAuth handlers. */
export function resolveOAuthApplicationUrl(
  baseUrl: string | undefined,
  env: EnvironmentConfig,
): URL {
  const candidate = baseUrl ?? env.appUrl;
  if (!candidate) {
    if (isExplicitLocalOAuthEnvironment(env)) return new URL(LOCAL_DEVELOPMENT_APP_URL);
    throw new Error(
      "OAuth callback base URL not configured: set APP_URL (or pass baseUrl) outside explicit development/test environments.",
    );
  }
  if (candidate.trim() !== candidate) {
    throw invalidApplicationUrl("the URL must not contain surrounding whitespace");
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw invalidApplicationUrl("expected an absolute HTTP(S) URL");
  }

  if (parsed.protocol !== "https:") {
    if (!isExplicitLocalOAuthEnvironment(env) || !isLoopbackHttpUrl(parsed)) {
      throw invalidApplicationUrl(
        "HTTPS is required outside explicit development/test loopback environments",
      );
    }
  }
  if (parsed.username || parsed.password) {
    throw invalidApplicationUrl("credentials are not allowed");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw invalidApplicationUrl("use an origin without a path, query, or fragment");
  }

  return parsed;
}

/** Build the exact callback URI used in both authorization and token requests. */
export function buildOAuthCallbackUrl(appUrl: URL, serviceId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(serviceId)) {
    throw new Error("OAuth serviceId contains unsupported characters");
  }
  return new URL(`/api/auth/${encodeURIComponent(serviceId)}/callback`, appUrl).toString();
}

/** Resolve a post-flow redirect while preventing an OAuth client open redirector. */
export function resolveOAuthCompletionRedirect(appUrl: URL, target: string): URL {
  let resolved: URL;
  try {
    resolved = new URL(target, appUrl);
  } catch {
    throw new Error("OAuth completion redirect must be a valid URL or path");
  }
  if (resolved.origin !== appUrl.origin) {
    throw new Error("OAuth completion redirect must use the same origin as the application URL");
  }
  if (resolved.username || resolved.password) {
    throw new Error("OAuth completion redirect must not contain credentials");
  }
  return resolved;
}

export function createOAuthRedirect(url: string | URL): Response {
  return new Response(null, {
    status: 302,
    headers: {
      ...OAUTH_RESPONSE_HEADERS,
      Location: String(url),
    },
  });
}

export function createOAuthJsonResponse(
  body: unknown,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(OAUTH_RESPONSE_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return Response.json(body, { ...init, headers });
}
