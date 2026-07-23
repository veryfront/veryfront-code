import type { Handler, HttpServer, ServeOptions } from "./types.ts";
import { LOCALHOST } from "../constants.ts";
import { getNativeDeno, getNativeResponse, toNativeResponse } from "./native-response.ts";
import { NOT_SUPPORTED } from "#veryfront/errors/error-registry/general.ts";
import { SERVER_START_ERROR } from "#veryfront/errors/error-registry/server.ts";

export class DenoHttpServer implements HttpServer {
  private abortController?: AbortController;
  private finished?: Promise<void>;

  async serve(handler: Handler, options: ServeOptions = {}): Promise<void> {
    if (this.finished) {
      throw SERVER_START_ERROR.create({ detail: "HTTP server is already running" });
    }

    const { port = 8000, hostname = LOCALHOST.IPV4, signal, onListen } = options;
    if (signal?.aborted) return;

    this.abortController = new AbortController();
    const controller = this.abortController;
    const relayAbort = (): void => controller.abort(signal?.reason);
    signal?.addEventListener("abort", relayAbort, { once: true });

    // Access native Deno.serve via `self` to bypass dnt shim transform.
    const nativeDeno = getNativeDeno();
    if (!nativeDeno) {
      signal?.removeEventListener("abort", relayAbort);
      this.abortController = undefined;
      throw NOT_SUPPORTED.create({ detail: "Deno.serve() is not available in this runtime" });
    }

    // Access native Response via `self` to bypass dnt shim transform.
    // In npm packages, dnt replaces Response with undici's polyfill,
    // but Deno.serve requires native Response instances.
    const NativeResponse = getNativeResponse();

    const wrappedHandler: Handler = async (req) => {
      const response: Response = await handler(req);
      return toNativeResponse(response, NativeResponse);
    };

    try {
      const httpServer = nativeDeno.serve(
        {
          port,
          hostname,
          signal: controller.signal,
          onListen: (address) => onListen?.(address),
        },
        wrappedHandler,
      );

      // Block until the server stops. This keeps the lifecycle contract the
      // same across Deno and Node and lets close() await actual shutdown.
      const finished = httpServer.finished;
      this.finished = finished;
      await finished;
    } finally {
      signal?.removeEventListener("abort", relayAbort);
      if (this.abortController === controller) this.abortController = undefined;
      this.finished = undefined;
    }
  }

  async close(): Promise<void> {
    const finished = this.finished;
    this.abortController?.abort();
    await finished;
  }
}
