import { isDeno } from "veryfront/platform";
import { constantTimeEqual } from "veryfront/security";
import { escapeHtml } from "veryfront/utils/html-escape";
import {
  DEFAULT_CALLBACK_PORT,
  DEFAULT_LOGIN_TIMEOUT_MS,
  MAX_PORT_ATTEMPTS,
} from "../shared/constants.ts";

export interface CallbackResult {
  token: string;
  error?: string;
}

export interface CallbackServer {
  port: number;
  waitForCallback(timeoutMs?: number): Promise<CallbackResult>;
  stop(): Promise<void>;
}

/** Options for the loopback OAuth callback server. */
export interface StartCallbackServerOptions {
  /**
   * Expected `state` nonce for this login flow (CSRF / session-fixation
   * binding). When set, the callback accepts a token ONLY when the request
   * carries a `?state=` that matches this value. Missing or mismatched state
   * is rejected. Generate this with a CSPRNG (see `generateCallbackState`).
   * When omitted, state is not enforced (kept for callers that do not pass a
   * state through the authorization URL).
   */
  expectedState?: string;
}

/**
 * Generate a cryptographically random `state` nonce for the loopback OAuth
 * flow. Uses the platform CSPRNG (`crypto.getRandomValues`), never
 * `Math.random`. Mirrors the server-side web flow in `src/oauth/providers`.
 */
export function generateCallbackState(): string {
  // 32 random bytes rendered as hex (256 bits of entropy).
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Reject callback requests that carry a cross-origin `Origin` header.
 *
 * The real CSRF defense for the loopback flow is the single-use `state` nonce
 * (validated in `handleCallback`); this is a cheap secondary check. A legitimate
 * top-level browser redirect from the authorization server to
 * `http://127.0.0.1:<port>/callback` is a GET navigation that carries no
 * `Origin` header, so a present cross-site `Origin` indicates a programmatic
 * cross-origin request (login CSRF) and is rejected.
 *
 * `Referer` is deliberately NOT used as a rejection trigger: on the https->http
 * (loopback) downgrade browsers strip or vary it by `Referrer-Policy`, so
 * rejecting on a cross-site `Referer` would break legitimate logins for no
 * security gain beyond the `state` nonce.
 *
 * Returns `true` when the request must be rejected.
 */
function isCrossOriginRequest(headers: { origin: string | null }): boolean {
  return isForeignHeader(headers.origin);
}

function isForeignHeader(value: string | null): boolean {
  // Absent header is the normal case for a top-level redirect: allow it.
  if (!value) return false;
  // Some browsers send the opaque "null" origin (e.g. sandboxed/privacy
  // contexts) for a legitimate top-level navigation. Treat it as not foreign.
  if (value === "null") return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    // An unparseable Origin/Referer is not a trusted same-origin value.
    return true;
  }
  return !isLoopbackHost(parsed.hostname);
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" ||
    hostname === "::1";
}

/** Normalize a Node.js header value (`string | string[] | undefined`) to `string | null`. */
function headerValue(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function renderSuccessPage(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Logged in</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: #fff;
      color: #111;
    }
    .container {
      text-align: center;
      padding: 48px;
    }
    .icon {
      width: 48px;
      height: 48px;
      margin: 0 auto 24px;
      border-radius: 50%;
      background: #f0fdf4;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .icon svg {
      width: 24px;
      height: 24px;
      color: #16a34a;
    }
    h1 {
      font-size: 18px;
      font-weight: 500;
      letter-spacing: -0.01em;
      margin-bottom: 8px;
    }
    p {
      font-size: 14px;
      color: #6b7280;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </div>
    <h1>Logged in</h1>
    <p>You can close this window</p>
  </div>
</body>
</html>`;
}

function renderErrorPage(error: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Login failed</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: #fff;
      color: #111;
    }
    .container {
      text-align: center;
      padding: 48px;
    }
    .icon {
      width: 48px;
      height: 48px;
      margin: 0 auto 24px;
      border-radius: 50%;
      background: #fef2f2;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .icon svg {
      width: 24px;
      height: 24px;
      color: #dc2626;
    }
    h1 {
      font-size: 18px;
      font-weight: 500;
      letter-spacing: -0.01em;
      margin-bottom: 8px;
    }
    p {
      font-size: 14px;
      color: #6b7280;
      max-width: 280px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </div>
    <h1>Login failed</h1>
    <p>${escapeHtml(error)}</p>
  </div>
</body>
</html>`;
}

function createWaitForCallback(
  callbackPromise: Promise<CallbackResult>,
): (timeoutMs?: number) => Promise<CallbackResult> {
  return function waitForCallback(
    timeoutMs: number = DEFAULT_LOGIN_TIMEOUT_MS,
  ): Promise<CallbackResult> {
    const timeout = new Promise<CallbackResult>((_, reject) => {
      setTimeout(() => reject(new Error("Login timed out. Please try again.")), timeoutMs);
    });

    return Promise.race([callbackPromise, timeout]);
  };
}

function isAddrInUseError(error: unknown): boolean {
  if (error instanceof Error) {
    // Deno: "AddrInUse: Address already in use (os error 48)" - error.name is "AddrInUse"
    // Node.js: error.code is "EADDRINUSE"
    const name = error.name || "";
    const message = error.message || "";
    const code = (error as { code?: string }).code || "";
    return name === "AddrInUse" || code === "EADDRINUSE" || message.includes("EADDRINUSE");
  }
  return false;
}

interface CallbackRequest {
  url: URL;
  origin: string | null;
}

function handleCallback(
  request: CallbackRequest,
  expectedState?: string,
): { result: CallbackResult; html: string } {
  // Reject browser-initiated cross-origin requests (login CSRF). A legitimate
  // top-level redirect does not carry a cross-site Origin header.
  if (isCrossOriginRequest(request)) {
    const message = "Rejected cross-origin callback request";
    return { result: { token: "", error: message }, html: renderErrorPage(message) };
  }

  const token = request.url.searchParams.get("token");
  const error = request.url.searchParams.get("error");
  const state = request.url.searchParams.get("state");

  if (error) return { result: { token: "", error }, html: renderErrorPage(error) };

  // When a state nonce was generated for this flow, the callback MUST carry a
  // matching state before any token is accepted. Missing or mismatched state
  // is a CSRF / session-fixation attempt and is rejected. The state value is
  // never included in the error message or logged.
  if (expectedState !== undefined) {
    if (!state) {
      const message = "Missing state parameter";
      return { result: { token: "", error: message }, html: renderErrorPage(message) };
    }
    if (!constantTimeEqual(state, expectedState)) {
      const message = "Invalid state parameter";
      return { result: { token: "", error: message }, html: renderErrorPage(message) };
    }
  }

  if (token) return { result: { token }, html: renderSuccessPage() };

  const message = "No token received";
  return { result: { token: "", error: message }, html: renderErrorPage(message) };
}

function tryStartDenoServer(port: number, expectedState?: string): CallbackServer {
  let resolveCallback: (result: CallbackResult) => void = () => {};
  const callbackPromise = new Promise<CallbackResult>((resolve) => {
    resolveCallback = resolve;
  });

  // Access native Deno.serve via `self` to bypass dnt shim transform.
  const nativeDeno = (self as unknown as Record<string, typeof Deno>)["Deno"]!;
  const server = nativeDeno.serve(
    { port, hostname: "127.0.0.1", onListen: () => {} },
    (request: Request) => {
      const url = new URL(request.url);

      if (url.pathname !== "/callback") {
        return new Response("Not Found", { status: 404, headers: { Connection: "close" } });
      }

      const { result, html } = handleCallback({
        url,
        origin: request.headers.get("origin"),
      }, expectedState);
      resolveCallback(result);

      // Close connection immediately to allow clean server shutdown
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8", Connection: "close" },
      });
    },
  );

  return {
    port,
    waitForCallback: createWaitForCallback(callbackPromise),
    stop: async function stop(): Promise<void> {
      await server.shutdown();
    },
  };
}

function startDenoServer(startPort: number, expectedState?: string): CallbackServer {
  for (let port = startPort, i = 0; i < MAX_PORT_ATTEMPTS; i++, port++) {
    try {
      return tryStartDenoServer(port, expectedState);
    } catch (error) {
      if (!isAddrInUseError(error) || i === MAX_PORT_ATTEMPTS - 1) {
        throw error;
      }
      // Port in use, try next port
    }
  }
  throw new Error("Could not find an available port");
}

async function tryStartNodeServer(port: number, expectedState?: string): Promise<CallbackServer> {
  const http = await import("node:http");

  let resolveCallback: (result: CallbackResult) => void = () => {};
  const callbackPromise = new Promise<CallbackResult>((resolve) => {
    resolveCallback = resolve;
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

    if (url.pathname !== "/callback") {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }

    const { result, html } = handleCallback({
      url,
      origin: headerValue(req.headers.origin),
    }, expectedState);
    resolveCallback(result);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  return {
    port,
    waitForCallback: createWaitForCallback(callbackPromise),
    stop: function stop(): Promise<void> {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function startNodeServer(startPort: number, expectedState?: string): Promise<CallbackServer> {
  for (let port = startPort, i = 0; i < MAX_PORT_ATTEMPTS; i++, port++) {
    try {
      return await tryStartNodeServer(port, expectedState);
    } catch (error) {
      if (!isAddrInUseError(error) || i === MAX_PORT_ATTEMPTS - 1) {
        throw error;
      }
      // Port in use, try next port
    }
  }
  throw new Error("Could not find an available port");
}

export async function startCallbackServer(
  preferredPort: number = DEFAULT_CALLBACK_PORT,
  options: StartCallbackServerOptions = {},
): Promise<CallbackServer> {
  const { expectedState } = options;
  // Server functions handle port retry internally to avoid race conditions
  return isDeno
    ? startDenoServer(preferredPort, expectedState)
    : startNodeServer(preferredPort, expectedState);
}

export function getCallbackUrl(port: number): string {
  return `http://localhost:${port}/callback`;
}
