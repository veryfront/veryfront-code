import * as dntShim from "../../../_dnt.shims.js";
import { isDeno } from "../../platform/compat/runtime.js";
import { DEFAULT_CALLBACK_PORT, DEFAULT_LOGIN_TIMEOUT_MS, MAX_PORT_ATTEMPTS } from "./constants.js";
function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function renderSuccessPage() {
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
function renderErrorPage(error) {
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
function createWaitForCallback(callbackPromise) {
    return function waitForCallback(timeoutMs = DEFAULT_LOGIN_TIMEOUT_MS) {
        const timeout = new Promise((_, reject) => {
            dntShim.setTimeout(() => reject(new Error("Login timed out. Please try again.")), timeoutMs);
        });
        return Promise.race([callbackPromise, timeout]);
    };
}
async function findAvailablePort(startPort) {
    let port = startPort;
    for (let i = 0; i < MAX_PORT_ATTEMPTS; i++) {
        try {
            if (isDeno) {
                // @ts-ignore - Deno global
                const listener = dntShim.Deno.listen({ port, hostname: "127.0.0.1" });
                listener.close();
                return port;
            }
            const net = await import("node:net");
            const available = await new Promise((resolve) => {
                const server = net.createServer();
                server.once("error", () => resolve(false));
                server.once("listening", () => {
                    server.close();
                    resolve(true);
                });
                server.listen(port, "127.0.0.1");
            });
            if (available)
                return port;
        }
        catch {
            // Port in use
        }
        port++;
    }
    throw new Error("Could not find an available port");
}
function handleCallback(url) {
    const token = url.searchParams.get("token");
    const error = url.searchParams.get("error");
    if (error)
        return { result: { token: "", error }, html: renderErrorPage(error) };
    if (token)
        return { result: { token }, html: renderSuccessPage() };
    const message = "No token received";
    return { result: { token: "", error: message }, html: renderErrorPage(message) };
}
function startDenoServer(port) {
    let resolveCallback;
    const callbackPromise = new Promise((resolve) => {
        resolveCallback = resolve;
    });
    // @ts-ignore - Deno global
    const server = dntShim.Deno.serve({ port, hostname: "127.0.0.1", onListen: () => { } }, (request) => {
        const url = new URL(request.url);
        if (url.pathname !== "/callback") {
            return new dntShim.Response("Not Found", { status: 404, headers: { Connection: "close" } });
        }
        const { result, html } = handleCallback(url);
        resolveCallback(result);
        // Close connection immediately to allow clean server shutdown
        return new dntShim.Response(html, {
            headers: { "Content-Type": "text/html; charset=utf-8", Connection: "close" },
        });
    });
    return {
        port,
        waitForCallback: createWaitForCallback(callbackPromise),
        stop: async () => {
            await server.shutdown();
        },
    };
}
async function startNodeServer(port) {
    const http = await import("node:http");
    let resolveCallback;
    const callbackPromise = new Promise((resolve) => {
        resolveCallback = resolve;
    });
    const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
        if (url.pathname !== "/callback") {
            res.statusCode = 404;
            res.end("Not Found");
            return;
        }
        const { result, html } = handleCallback(url);
        resolveCallback(result);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(html);
    });
    await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
    return {
        port,
        waitForCallback: createWaitForCallback(callbackPromise),
        stop: () => new Promise((resolve) => server.close(() => resolve())),
    };
}
export async function startCallbackServer(preferredPort = DEFAULT_CALLBACK_PORT) {
    const port = await findAvailablePort(preferredPort);
    return isDeno ? startDenoServer(port) : startNodeServer(port);
}
export function getCallbackUrl(port) {
    return `http://localhost:${port}/callback`;
}
