export interface ServeOptions {
  port?: number;

  hostname?: string;

  signal?: AbortSignal;

  onListen?: (params: { hostname: string; port: number }) => void;
}

export type Handler = (request: Request) => Response | Promise<Response>;

export interface HttpServer {
  serve(handler: Handler, options?: ServeOptions): Promise<void>;

  close(): Promise<void>;
}
