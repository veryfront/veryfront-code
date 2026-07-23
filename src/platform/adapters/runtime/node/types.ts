export interface WSWebSocket extends EventTarget {
  on(event: "open", listener: () => void): this;
  on(event: "message", listener: (data: WSMessageData, isBinary: boolean) => void): this;
  on(
    event: "close",
    listener: (code?: number, reason?: import("node:buffer").Buffer) => void,
  ): this;
  on(event: "error", listener: (error: Error) => void): this;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
}

export type WSMessageData = string | ArrayBuffer | Uint8Array | readonly Uint8Array[];

export interface NodeIncomingMessage {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  on(event: "data", listener: (chunk: Uint8Array) => void): void;
  on(event: "end" | "aborted", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  pause?(): void;
  resume?(): void;
  destroy?(error?: Error): void;
}

export interface NodeServerResponse {
  statusCode: number;
  statusMessage: string;
  setHeader(name: string, value: string): void;
  write(chunk: Uint8Array): void;
  end(): void;
}

export interface NodeHttpServer {
  listen(port: number, hostname: string, callback: () => void): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
  close(callback?: (error?: Error) => void): void;
  closeIdleConnections?(): void;
  closeAllConnections?(): void;
  address(): string | { address: string; family: string; port: number } | null;
}

export interface NodeUpgradeSocket {
  readonly destroyed: boolean;
  readonly writableEnded: boolean;
  write(chunk: string | Uint8Array): boolean;
  end(chunk?: string | Uint8Array): void;
  destroy(error?: Error): void;
  once(event: "close" | "drain", listener: () => void): void;
  once(event: "error", listener: (error: Error) => void): void;
  off(event: "close" | "drain", listener: () => void): void;
  off(event: "error", listener: (error: Error) => void): void;
}

export interface WSWebSocketServer {
  clients: Set<WSWebSocket>;
  close(callback?: (error?: Error) => void): void;
  on(event: "error", listener: (error: Error) => void): this;
  on(
    event: "headers",
    listener: (headers: string[], request: NodeIncomingMessage) => void,
  ): this;
  handleUpgrade(
    request: unknown,
    socket: unknown,
    head: unknown,
    callback: (ws: WSWebSocket) => void,
  ): void;
  emit(event: string, ws: WSWebSocket, request: unknown): void;
}
