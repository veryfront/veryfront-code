import type { Handler, HttpServer, ServeOptions } from "./types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import type {
  NodeHttpModule,
  NodeIncomingMessage,
  NodeServer,
  NodeServerResponse,
  NodeUrlModule,
} from "./node-types.ts";
import { convertNodeRequestToWebRequest } from "./request-adapter.ts";
import { LOCALHOST } from "../constants.ts";
import { SERVER_START_ERROR } from "#veryfront/errors/error-registry/server.ts";

type ServerState = "idle" | "starting" | "running" | "closing";

function waitForDrain(res: NodeServerResponse): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      res.off("drain", onDrain);
      res.off("close", onClose);
      res.off("error", onError);
    };
    const onDrain = (): void => {
      cleanup();
      resolve();
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error("HTTP response closed before the body was written"));
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    res.once("drain", onDrain);
    res.once("close", onClose);
    res.once("error", onError);
  });
}

function responseMustNotHaveBody(method: string | undefined, status: number): boolean {
  return method?.toUpperCase() === "HEAD" || status === 204 || status === 304 ||
    (status >= 100 && status < 200);
}

function setResponseHeaders(res: NodeServerResponse, response: Response): void {
  for (const [name, value] of response.headers) {
    if (name.toLowerCase() !== "set-cookie") res.setHeader(name, value);
  }

  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [...headers]
    .filter(([name]) => name.toLowerCase() === "set-cookie")
    .map(([, value]) => value);
  if (cookies.length > 0) res.setHeader("set-cookie", cookies);
}

export async function writeNodeResponse(
  req: NodeIncomingMessage,
  res: NodeServerResponse,
  response: Response,
): Promise<void> {
  res.statusCode = response.status;
  if (response.statusText) res.statusMessage = response.statusText;
  setResponseHeaders(res, response);

  if (!response.body) {
    res.end();
    return;
  }

  if (responseMustNotHaveBody(req.method, response.status)) {
    await response.body.cancel("HTTP response must not include a body");
    res.end();
    return;
  }

  const reader = response.body.getReader();
  let sourceSettled = false;
  const handleClose = (): void => {
    if (!sourceSettled) void reader.cancel("HTTP client disconnected").catch(() => {});
  };
  res.on("close", handleClose);

  try {
    while (!res.destroyed) {
      const { done, value } = await reader.read();
      if (done) {
        sourceSettled = true;
        break;
      }
      if (!res.write(value)) await waitForDrain(res);
    }
    if (!res.destroyed && !res.writableEnded) res.end();
  } finally {
    sourceSettled = true;
    res.off("close", handleClose);
    try {
      reader.releaseLock();
    } catch {
      // The reader may already be released by a runtime-specific stream.
    }
  }
}

export class NodeHttpServer implements HttpServer {
  private http: NodeHttpModule | null = null;
  private url: NodeUrlModule | null = null;
  private server: NodeServer | null = null;
  private state: ServerState = "idle";
  private closeRequested = false;
  private finished: Promise<void> | null = null;
  private startup: Promise<void> | null = null;

  private async initNodeModules(): Promise<void> {
    try {
      this.http = (await import("node:http")) as NodeHttpModule;
      this.url = (await import("node:url")) as NodeUrlModule;
    } catch (_) {
      /* expected: node:http/node:url not available in non-Node runtimes */
      throw toError(
        createError({
          type: "not_supported",
          message: "Node.js http modules not available",
          feature: "Node.js",
        }),
      );
    }
  }

  async serve(handler: Handler, options: ServeOptions = {}): Promise<void> {
    if (this.state !== "idle") {
      throw SERVER_START_ERROR.create({ detail: "HTTP server is already running" });
    }
    if (options.signal?.aborted) return;

    this.state = "starting";
    this.closeRequested = false;
    let resolveStartup: (() => void) | undefined;
    const startup = new Promise<void>((resolve) => {
      resolveStartup = resolve;
    });
    this.startup = startup;
    try {
      if (!this.http || !this.url) await this.initNodeModules();
    } catch (error) {
      this.state = "idle";
      resolveStartup?.();
      if (this.startup === startup) this.startup = null;
      throw error;
    }

    const { port = 8000, hostname = LOCALHOST.IPV4 } = options;
    const http = this.http!;
    const urlModule = this.url!;

    const server = http.createServer(
      async (req: NodeIncomingMessage, res: NodeServerResponse) => {
        try {
          const hostHeader = req.headers.host;
          const requestHost = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
          const url = new urlModule.URL(
            req.url ?? "/",
            `http://${requestHost || `${hostname}:${port}`}`,
          );

          const request = convertNodeRequestToWebRequest(req, url.toString());
          const response = await handler(request);
          await writeNodeResponse(req, res, response);
        } catch (_error) {
          if (!res.headersSent && !res.writableEnded) {
            res.statusCode = 500;
            res.statusMessage = "Internal Server Error";
            res.end("Internal Server Error");
          } else if (!res.destroyed) {
            res.destroy();
          }
        }
      },
    );
    this.server = server;

    const signal = options.signal;
    let listening = false;
    let terminalError: unknown;
    let settled = false;
    const relayAbort = (): void => this.requestClose(server);

    const finished = new Promise<void>((resolve, reject) => {
      const settle = (error?: unknown): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", relayAbort);
        if (this.server === server) this.server = null;
        this.state = "idle";
        this.closeRequested = false;
        if (error !== undefined) reject(error);
        else resolve();
      };

      server.on("error", (error: unknown) => {
        if (!listening) {
          settle(error);
          return;
        }
        terminalError = error;
        this.requestClose(server);
      });
      server.on("close", () => settle(terminalError));

      signal?.addEventListener("abort", relayAbort, { once: true });
      try {
        server.listen(port, hostname, () => {
          listening = true;
          this.state = "running";
          const address = server.address?.();
          const actualPort = address && typeof address === "object" ? address.port : port;
          try {
            options.onListen?.({ hostname, port: actualPort });
          } catch (error) {
            terminalError = error;
            this.requestClose(server);
            return;
          }
          if (this.closeRequested) this.requestClose(server);
        });
      } catch (error) {
        settle(error);
      }
    });

    this.finished = finished;
    resolveStartup?.();
    try {
      await finished;
    } finally {
      if (this.finished === finished) this.finished = null;
      if (this.startup === startup) this.startup = null;
    }
  }

  async close(): Promise<void> {
    this.closeRequested = true;
    await this.startup;
    const server = this.server;
    if (server) this.requestClose(server);
    await this.finished;
  }

  private requestClose(server: NodeServer): void {
    if (this.state === "starting") {
      this.closeRequested = true;
      return;
    }
    if (this.state === "closing" || this.state === "idle") return;

    this.state = "closing";
    server.close();
  }
}
