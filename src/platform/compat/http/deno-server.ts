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
    await nativeDeno.serve({ port, hostname, signal: serveSignal }, handler);
  }

  close(): Promise<void> {
    this.abortController?.abort();
    return Promise.resolve();
  }
}
