import { awaitAbortable, createAbortError, throwIfAborted } from "#veryfront/utils/abort.ts";
import { hasProjectIdentityControlCharacters } from "#veryfront/utils/project-identity.ts";
import { cancelProxyResponseBody } from "./response-body.ts";
import { MAX_PROXY_TIMER_DELAY_MS } from "./timing.ts";
import { normalizeProxyOriginFormPath } from "./request-path.ts";
import { withProxyStreamingBodyDuplex } from "./request-init.ts";

const MAX_OUTBOUND_URL_CODE_UNITS = 4_096;
export const API_PROXY_PATH_PREFIX = "/_vf/api";

export class ProxyOutboundRequestTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Proxy outbound request timed out after ${timeoutMs}ms`);
    this.name = "ProxyOutboundRequestTimeoutError";
  }
}

export interface FetchWithProxyDeadlineOptions {
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly init?: Omit<RequestInit, "signal">;
  readonly fetchImpl?: typeof fetch;
}

function requireTimeoutMs(timeoutMs: number): void {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_PROXY_TIMER_DELAY_MS
  ) {
    throw new RangeError(
      `Proxy outbound timeout must be an integer between 1 and ${MAX_PROXY_TIMER_DELAY_MS}`,
    );
  }
}

function parseOutboundBaseUrl(baseUrl: string, allowPath: boolean): URL {
  if (
    typeof baseUrl !== "string" ||
    baseUrl.length === 0 ||
    baseUrl.length > MAX_OUTBOUND_URL_CODE_UNITS ||
    baseUrl !== baseUrl.trim() ||
    baseUrl.includes("\\") ||
    hasProjectIdentityControlCharacters(baseUrl)
  ) {
    throw new TypeError("Proxy outbound base URL is invalid");
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new TypeError("Proxy outbound base URL is invalid");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !parsed.hostname ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    (!allowPath && parsed.pathname !== "/")
  ) {
    throw new TypeError(
      `Proxy outbound base URL must be a credential-free HTTP(S) ${allowPath ? "URL" : "origin"}`,
    );
  }
  return parsed;
}

/**
 * Resolve a public request against a renderer origin without allowing a path
 * beginning with `//` to be reinterpreted as a protocol-relative authority.
 */
export function createRendererTargetUrl(baseUrl: string, requestUrl: URL): URL {
  const target = parseOutboundBaseUrl(baseUrl, false);
  target.pathname = normalizeProxyOriginFormPath(requestUrl.pathname);
  target.search = requestUrl.search;
  target.hash = "";
  return target;
}

/** Resolve the BFF API path while retaining an optional API base-path prefix. */
export function createApiTargetUrl(baseUrl: string, requestUrl: URL): URL {
  const requestPath = requestUrl.pathname;
  if (
    requestPath !== API_PROXY_PATH_PREFIX &&
    !requestPath.startsWith(`${API_PROXY_PATH_PREFIX}/`)
  ) {
    throw new TypeError("Request path is outside the proxy API namespace");
  }

  const target = parseOutboundBaseUrl(baseUrl, true);
  const apiPath = requestPath.slice(API_PROXY_PATH_PREFIX.length) || "/";
  const basePath = target.pathname === "/"
    ? ""
    : target.pathname.endsWith("/")
    ? target.pathname.slice(0, -1)
    : target.pathname;
  target.pathname = `${basePath}${apiPath}`;
  target.search = requestUrl.search;
  target.hash = "";
  return target;
}

/**
 * Fetch with one deadline linked to the incoming request. Cancellation wins
 * even if a fetch implementation ignores its signal; a late response body is
 * canceled so it cannot retain a connection after the caller has moved on.
 */
export async function fetchWithProxyDeadline(
  input: string | URL | Request,
  options: FetchWithProxyDeadlineOptions,
): Promise<Response> {
  requireTimeoutMs(options.timeoutMs);
  const fetchImpl = options.fetchImpl ?? fetch;
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Proxy outbound fetch implementation must be a function");
  }

  const controller = new AbortController();
  const timeoutError = new ProxyOutboundRequestTimeoutError(options.timeoutMs);
  const timeoutId = setTimeout(() => controller.abort(timeoutError), options.timeoutMs);
  const abortFromCaller = (): void => {
    controller.abort(createAbortError(options.signal?.reason));
  };
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const request = Promise.resolve().then(() => {
      throwIfAborted(controller.signal);
      return fetchImpl(
        input,
        withProxyStreamingBodyDuplex({
          ...options.init,
          signal: controller.signal,
        }),
      );
    });
    void request.then(
      (lateResponse) => {
        if (controller.signal.aborted) void cancelProxyResponseBody(lateResponse);
      },
      () => {
        // The awaited request path owns failure classification.
      },
    );
    return await awaitAbortable(request, controller.signal);
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

/** Wait for retry backoff without retaining a timer after request cancellation. */
export function waitForProxyDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (
    !Number.isSafeInteger(delayMs) ||
    delayMs < 0 ||
    delayMs > MAX_PROXY_TIMER_DELAY_MS
  ) {
    throw new RangeError(
      `Proxy delay must be an integer between 0 and ${MAX_PROXY_TIMER_DELAY_MS}`,
    );
  }
  throwIfAborted(signal);
  if (delayMs === 0) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
      reject(createAbortError(signal?.reason));
    };
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
