import { isDeno } from "@veryfront/platform/compat/runtime.ts";
import { DEFAULT_CALLBACK_PORT, DEFAULT_LOGIN_TIMEOUT_MS, MAX_PORT_ATTEMPTS } from "./constants.ts";

export interface CallbackResult {
  token: string;
  error?: string;
}

export interface CallbackServer {
  port: number;
  waitForCallback(timeoutMs?: number): Promise<CallbackResult>;
  stop(): Promise<void>;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const baseStyle = `
  body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #fafafa; }
  .container { text-align: center; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { color: #666; margin: 0; font-size: 14px; }
`;

function renderPage(title: string, heading: string, message: string, color: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>${baseStyle}h1{color:${color};}</style></head><body><div class="container"><h1>${heading}</h1><p>${message}</p></div></body></html>`;
}

const successHtml = () =>
  renderPage("Login Successful", "✓ Logged in", "You can close this window.", "#22c55e");
const errorHtml = (err: string) =>
  renderPage("Login Failed", "✗ Login failed", escapeHtml(err), "#ef4444");

async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;

  for (let i = 0; i < MAX_PORT_ATTEMPTS; i++) {
    try {
      if (isDeno) {
        // @ts-ignore - Deno global
        const listener = Deno.listen({ port, hostname: "127.0.0.1" });
        listener.close();
        return port;
      } else {
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
      // Port in use
    }
    port++;
  }

  throw new Error("Could not find an available port");
}

function handleCallback(url: URL): { result: CallbackResult; html: string } {
  const token = url.searchParams.get("token");
  const error = url.searchParams.get("error");

  if (error) return { result: { token: "", error }, html: errorHtml(error) };
  if (token) return { result: { token }, html: successHtml() };
  return {
    result: { token: "", error: "No token received" },
    html: errorHtml("No token received"),
  };
}

function startDenoServer(port: number): CallbackServer {
  let resolveCallback: (result: CallbackResult) => void;
  const callbackPromise = new Promise<CallbackResult>((resolve) => {
    resolveCallback = resolve;
  });

  // @ts-ignore - Deno global
  const server = Deno.serve(
    { port, hostname: "127.0.0.1", onListen: () => {} },
    (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname === "/callback") {
        const { result, html } = handleCallback(url);
        resolveCallback!(result);
        // Close connection immediately to allow clean server shutdown
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8", Connection: "close" },
        });
      }
      return new Response("Not Found", { status: 404, headers: { Connection: "close" } });
    },
  );

  return {
    port,
    waitForCallback: (timeoutMs = DEFAULT_LOGIN_TIMEOUT_MS) => {
      const timeout = new Promise<CallbackResult>((_, reject) => {
        setTimeout(() => reject(new Error("Login timed out. Please try again.")), timeoutMs);
      });
      return Promise.race([callbackPromise, timeout]);
    },
    stop: async () => {
      await server.shutdown();
    },
  };
}

async function startNodeServer(port: number): Promise<CallbackServer> {
  const http = await import("node:http");
  let resolveCallback: (result: CallbackResult) => void;
  const callbackPromise = new Promise<CallbackResult>((resolve) => {
    resolveCallback = resolve;
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    if (url.pathname === "/callback") {
      const { result, html } = handleCallback(url);
      resolveCallback!(result);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(html);
      return;
    }
    res.statusCode = 404;
    res.end("Not Found");
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

  return {
    port,
    waitForCallback: (timeoutMs = DEFAULT_LOGIN_TIMEOUT_MS) => {
      const timeout = new Promise<CallbackResult>((_, reject) => {
        setTimeout(() => reject(new Error("Login timed out. Please try again.")), timeoutMs);
      });
      return Promise.race([callbackPromise, timeout]);
    },
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export async function startCallbackServer(
  preferredPort = DEFAULT_CALLBACK_PORT,
): Promise<CallbackServer> {
  const port = await findAvailablePort(preferredPort);
  return isDeno ? startDenoServer(port) : startNodeServer(port);
}

export function getCallbackUrl(port: number): string {
  return `http://localhost:${port}/callback`;
}
