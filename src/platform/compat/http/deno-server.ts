import type { Handler, HttpServer, ServeOptions } from "./types.ts";
import { LOCALHOST } from "../constants.ts";
import { getNativeResponse, toNativeResponse } from "./native-response.ts";

export class DenoHttpServer implements HttpServer {
  private abortController?: AbortController;

  async serve(handler: Handler, options: ServeOptions = {}): Promise<void> {
    const { port = 8000, hostname = LOCALHOST.IPV4, signal, onListen } = options;

    this.abortController = new AbortController();
    const serveSignal = signal ?? this.abortController.signal;

    onListen?.({ hostname, port });

    // Access native Deno.serve via `self` to bypass dnt shim transform.
    const nativeDeno = (self as unknown as Record<string, typeof Deno>)["Deno"]!;

    // Access native Response via `self` to bypass dnt shim transform.
    // In npm packages, dnt replaces Response with undici's polyfill,
    // but Deno.serve requires native Response instances.
    const NativeResponse = getNativeResponse();

    const wrappedHandler: Handler = async (req) => {
      const response: Response = await handler(req);
      return toNativeResponse(response, NativeResponse);
    };

    const httpServer = nativeDeno.serve(
      { port, hostname, signal: serveSignal },
      wrappedHandler,
    );

    // Block until the server stops (e.g. via signal abort).
    // Deno.serve() returns synchronously; without awaiting .finished
    // the event loop drains and the process exits in compiled binaries.
    await httpServer.finished;
  }

  close(): Promise<void> {
    this.abortController?.abort();
    return Promise.resolve();
  }
}
