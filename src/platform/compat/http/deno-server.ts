import type { Handler, HttpServer, ServeOptions } from "./types.ts";
import { LOCALHOST } from "../constants.ts";

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
    const NativeResponse = (self as unknown as { Response: typeof Response })
      .Response;

    const wrappedHandler: Handler = async (req) => {
      const response: Response = await handler(req);
      // If already native (compiled binary or WebSocket upgrade), return as-is
      if (response instanceof NativeResponse) return response;
      // Re-wrap polyfilled Response as native Response.
      // At runtime, `response` may be an undici Response (from dnt shim) that
      // fails Deno's native instanceof check. Cast to access its properties.
      const r = response as unknown as Response;
      return new NativeResponse(r.body, {
        status: r.status,
        statusText: r.statusText,
        headers: r.headers,
      });
    };

    await nativeDeno.serve(
      { port, hostname, signal: serveSignal },
      wrappedHandler,
    );
  }

  close(): Promise<void> {
    this.abortController?.abort();
    return Promise.resolve();
  }
}
