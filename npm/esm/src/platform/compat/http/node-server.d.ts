import type { Handler, HttpServer, ServeOptions } from "./types.js";
export declare class NodeHttpServer implements HttpServer {
    private http;
    private url;
    private server;
    private initNodeModules;
    serve(handler: Handler, options?: ServeOptions): Promise<void>;
    close(): Promise<void>;
}
//# sourceMappingURL=node-server.d.ts.map