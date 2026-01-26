import type { Handler, HttpServer, ServeOptions } from "./types.js";
export declare class DenoHttpServer implements HttpServer {
    private abortController?;
    serve(handler: Handler, options?: ServeOptions): Promise<void>;
    close(): Promise<void>;
}
//# sourceMappingURL=deno-server.d.ts.map