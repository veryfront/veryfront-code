import { escapeHtml } from "veryfront/utils/html-escape";
import { DEFAULT_CALLBACK_PORT } from "../shared/constants.ts";
import { startLoopbackCallbackServer } from "../shared/loopback-callback-server.ts";

export interface CallbackResult {
  token: string;
  error?: string;
}

export interface CallbackServer {
  port: number;
  waitForCallback(timeoutMs?: number): Promise<CallbackResult>;
  stop(): Promise<void>;
}

export interface CallbackServerOptions {
  expectedState?: string;
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

function callbackError(message: string): { result: CallbackResult; html: string } {
  return { result: { token: "", error: message }, html: renderErrorPage(message) };
}

function headerOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function hasCrossOriginOriginHeader(headers: Headers, url: URL): boolean {
  const expectedOrigin = url.origin;
  const origin = headers.get("origin");
  if (origin && headerOrigin(origin) !== expectedOrigin) return true;

  return false;
}

function hasCrossOriginRefererHeader(headers: Headers, url: URL): boolean {
  const expectedOrigin = url.origin;
  const referer = headers.get("referer");
  if (referer && headerOrigin(referer) !== expectedOrigin) return true;

  return false;
}

function handleCallback(
  url: URL,
  headers: Headers,
  options: CallbackServerOptions = {},
): { result: CallbackResult; html: string } {
  if (hasCrossOriginOriginHeader(headers, url)) return callbackError("Invalid callback origin");

  if (!options.expectedState && hasCrossOriginRefererHeader(headers, url)) {
    return callbackError("Invalid callback origin");
  }

  if (options.expectedState && url.searchParams.get("state") !== options.expectedState) {
    return callbackError("Invalid OAuth state");
  }

  const token = url.searchParams.get("token");
  const error = url.searchParams.get("error");

  if (error) return { result: { token: "", error }, html: renderErrorPage(error) };
  if (token) return { result: { token }, html: renderSuccessPage() };

  return callbackError("No token received");
}

export async function startCallbackServer(
  preferredPort: number = DEFAULT_CALLBACK_PORT,
  options: CallbackServerOptions = {},
): Promise<CallbackServer> {
  return await startLoopbackCallbackServer({
    timeoutMessage: "Login timed out. Please try again.",
    handle(url, headers) {
      const { result, html } = handleCallback(url, headers, options);
      return {
        result,
        response: new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
      };
    },
  }, preferredPort);
}

export function getCallbackUrl(port: number): string {
  return `http://localhost:${port}/callback`;
}
