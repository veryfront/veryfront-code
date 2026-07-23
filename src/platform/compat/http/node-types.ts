export interface NodeIncomingMessage {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  on(event: "data", handler: (chunk: Uint8Array) => void): void;
  on(event: "end", handler: () => void): void;
  on(event: "error", handler: (error: Error) => void): void;
  on(event: "aborted", handler: () => void): void;
  /** Pause flowing mode — used to apply backpressure to the request body. */
  pause?(): void;
  /** Resume flowing mode once the body stream consumer asks for more. */
  resume?(): void;
  destroy?(error?: Error): void;
}

export interface NodeServerResponse {
  statusCode: number;
  statusMessage?: string;
  readonly destroyed?: boolean;
  readonly headersSent?: boolean;
  readonly writableEnded?: boolean;
  setHeader(name: string, value: string | string[]): void;
  writeHead(statusCode: number, headers?: Record<string, string | string[]>): void;
  write(chunk: string | Uint8Array): boolean;
  end(chunk?: string | Uint8Array): void;
  on(event: "error", handler: (error: Error) => void): void;
  on(event: "close" | "drain", handler: () => void): void;
  once(event: "error", handler: (error: Error) => void): void;
  once(event: "close" | "drain", handler: () => void): void;
  off(event: "error", handler: (error: Error) => void): void;
  off(event: "close" | "drain", handler: () => void): void;
  destroy(error?: Error): void;
}

export interface NodeServer {
  listen(port: number, hostname: string, callback: () => void): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  close(callback?: (error?: Error) => void): void;
  address?(): string | { address: string; family: string; port: number } | null;
}

export interface NodeHttpModule {
  createServer(
    requestListener: (req: NodeIncomingMessage, res: NodeServerResponse) => void,
  ): NodeServer;
}

export interface NodeUrlModule {
  URL: typeof URL;
}
