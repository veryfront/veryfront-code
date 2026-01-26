import * as dntShim from "../../../../_dnt.shims.js";
import type { Handler, HttpServer, ServeOptions } from "./types.js";
import { LOCALHOST } from "../../../config/index.js";

export class DenoHttpServer implements HttpServer {
  private abortController?: AbortController;

  async serve(handler: Handler, options: ServeOptions = {}): Promise<void> {
    const { port = 8000, hostname = LOCALHOST.IPV4, signal, onListen } = options;

    this.abortController = new AbortController();
    const serveSignal = signal ?? this.abortController.signal;

    onListen?.({ hostname, port });

    await dntShim.Deno.serve({ port, hostname, signal: serveSignal }, handler);
  }

  close(): Promise<void> {
    this.abortController?.abort();
    return Promise.resolve();
  }
}
