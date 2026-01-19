import type { Handler, HttpServer, ServeOptions } from "./types.ts";
import { LOCALHOST } from "#veryfront/config";

export class DenoHttpServer implements HttpServer {
  private abortController?: AbortController;

  async serve(
    handler: Handler,
    options: ServeOptions = {},
  ): Promise<void> {
    const { port = 8000, hostname = LOCALHOST.IPV4 } = options;

    this.abortController = new AbortController();
    const signal = options.signal || this.abortController.signal;

    options.onListen?.({ hostname, port });

    await Deno.serve(
      {
        port,
        hostname,
        signal,
      },
      handler,
    );
  }

  close(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
    }
    return Promise.resolve();
  }
}
