import * as dntShim from "../../../../_dnt.shims.js";
import { LOCALHOST } from "../../../config/index.js";
export class DenoHttpServer {
    abortController;
    async serve(handler, options = {}) {
        const { port = 8000, hostname = LOCALHOST.IPV4, signal, onListen } = options;
        this.abortController = new AbortController();
        const serveSignal = signal ?? this.abortController.signal;
        onListen?.({ hostname, port });
        await dntShim.Deno.serve({ port, hostname, signal: serveSignal }, handler);
    }
    close() {
        this.abortController?.abort();
        return Promise.resolve();
    }
}
