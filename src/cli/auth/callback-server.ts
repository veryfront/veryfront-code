/**
 * Local HTTP server for receiving OAuth callbacks
 *
 * Starts an ephemeral HTTP server on localhost to receive
 * the OAuth callback with the authentication token.
 *
 * @module cli/auth/callback-server
 */

import { isDeno } from "@veryfront/platform/compat/runtime.ts";

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Result from the callback server
 */
export interface CallbackResult {
  /** The received token */
  token: string;
  /** Any error message from the OAuth flow */
  error?: string;
}

/**
 * Callback server interface
 */
export interface CallbackServer {
  /** The port the server is listening on */
  port: number;
  /** Wait for the callback to complete */
  waitForCallback(timeoutMs?: number): Promise<CallbackResult>;
  /** Stop the server */
  stop(): Promise<void>;
}

/**
 * HTML page shown after successful login
 */
const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Login Successful</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: #fafafa;
    }
    .container { text-align: center; }
    h1 { color: #22c55e; font-size: 20px; margin: 0 0 8px; }
    p { color: #666; margin: 0; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>✓ Logged in</h1>
    <p>You can close this window.</p>
  </div>
</body>
</html>`;

/**
 * HTML page shown after failed login
 */
const ERROR_HTML = (error: string) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Login Failed</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: #fafafa;
    }
    .container { text-align: center; }
    h1 { color: #ef4444; font-size: 20px; margin: 0 0 8px; }
    p { color: #666; margin: 0; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>✗ Login failed</h1>
    <p>${escapeHtml(error)}</p>
  </div>
</body>
</html>`;

/**
 * Find an available port starting from the given port
 */
async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;
  const maxAttempts = 100;

  for (let i = 0; i < maxAttempts; i++) {
    try {
      if (isDeno) {
        // @ts-ignore - Deno global
        const listener = Deno.listen({ port, hostname: "127.0.0.1" });
        listener.close();
        return port;
      } else {
        // Node.js: try to create a server
        const net = await import("node:net");
        const available = await new Promise<boolean>((resolve) => {
          const server = net.createServer();
          server.once("error", () => resolve(false));
          server.once("listening", () => {
            server.close();
            resolve(true);
          });
          server.listen(port, "127.0.0.1");
        });
        if (available) return port;
      }
    } catch {
      // Port in use, try next
    }
    port++;
  }

  throw new Error("Could not find an available port");
}

/**
 * Start a callback server using Deno's native HTTP server
 */
async function startDenoServer(port: number): Promise<CallbackServer> {
  let resolveCallback: (result: CallbackResult) => void;
  let rejectCallback: (error: Error) => void;
  const callbackPromise = new Promise<CallbackResult>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  // @ts-ignore - Deno global
  const server = Deno.serve(
    { port, hostname: "127.0.0.1", onListen: () => {} },
    (request: Request) => {
      const url = new URL(request.url);

      if (url.pathname === "/callback") {
        const token = url.searchParams.get("token");
        const error = url.searchParams.get("error");

        if (error) {
          resolveCallback!({ token: "", error });
          return new Response(ERROR_HTML(error), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }

        if (token) {
          resolveCallback!({ token });
          return new Response(SUCCESS_HTML, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }

        resolveCallback!({ token: "", error: "No token received" });
        return new Response(ERROR_HTML("No token received"), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  );

  return {
    port,
    waitForCallback: async (timeoutMs = 120000) => {
      const timeoutPromise = new Promise<CallbackResult>((_, reject) => {
        setTimeout(() => {
          reject(new Error("Login timed out. Please try again."));
        }, timeoutMs);
      });
      return Promise.race([callbackPromise, timeoutPromise]);
    },
    stop: async () => {
      await server.shutdown();
    },
  };
}

/**
 * Start a callback server using Node.js HTTP module
 */
async function startNodeServer(port: number): Promise<CallbackServer> {
  const http = await import("node:http");

  let resolveCallback: (result: CallbackResult) => void;
  let rejectCallback: (error: Error) => void;
  const callbackPromise = new Promise<CallbackResult>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

    if (url.pathname === "/callback") {
      const token = url.searchParams.get("token");
      const error = url.searchParams.get("error");

      res.setHeader("Content-Type", "text/html; charset=utf-8");

      if (error) {
        resolveCallback!({ token: "", error });
        res.end(ERROR_HTML(error));
        return;
      }

      if (token) {
        resolveCallback!({ token });
        res.end(SUCCESS_HTML);
        return;
      }

      resolveCallback!({ token: "", error: "No token received" });
      res.end(ERROR_HTML("No token received"));
      return;
    }

    res.statusCode = 404;
    res.end("Not Found");
  });

  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", resolve);
  });

  return {
    port,
    waitForCallback: async (timeoutMs = 120000) => {
      const timeoutPromise = new Promise<CallbackResult>((_, reject) => {
        setTimeout(() => {
          reject(new Error("Login timed out. Please try again."));
        }, timeoutMs);
      });
      return Promise.race([callbackPromise, timeoutPromise]);
    },
    stop: async () => {
      return new Promise((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

/**
 * Start a local HTTP server to receive OAuth callbacks
 *
 * @param preferredPort - The preferred port to use (default: 9876)
 * @returns The callback server instance
 */
export async function startCallbackServer(
  preferredPort = 9876,
): Promise<CallbackServer> {
  const port = await findAvailablePort(preferredPort);

  if (isDeno) {
    return startDenoServer(port);
  } else {
    return startNodeServer(port);
  }
}

/**
 * Get the callback URL for OAuth
 */
export function getCallbackUrl(port: number): string {
  return `http://localhost:${port}/callback`;
}
