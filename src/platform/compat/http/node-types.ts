export interface NodeIncomingMessage {
  method?: string;

  url?: string;

  headers: Record<string, string | string[] | undefined>;

  on(event: "data", handler: (chunk: Uint8Array) => void): void;

  on(event: "end", handler: () => void): void;

  on(event: "error", handler: (error: Error) => void): void;
}

export interface NodeServerResponse {
  statusCode: number;

  statusMessage?: string;

  setHeader(name: string, value: string | string[]): void;

  writeHead(statusCode: number, headers?: Record<string, string | string[]>): void;

  write(chunk: string | Uint8Array): void;

  end(chunk?: string | Uint8Array): void;

  on(event: "error", handler: (error: Error) => void): void;
}

export interface NodeServer {
  listen(port: number, hostname: string, callback: () => void): void;

  on(event: string, listener: (...args: unknown[]) => void): void;

  close(callback?: () => void): void;
}

export interface NodeHttpModule {
  createServer(
    requestListener: (req: NodeIncomingMessage, res: NodeServerResponse) => void,
  ): NodeServer;
}

export interface NodeUrlModule {
  URL: typeof URL;
}
