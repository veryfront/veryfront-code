export interface WSWebSocket extends EventTarget {
  on(event: "open", listener: () => void): this;
  on(event: "message", listener: (data: WSMessageData, isBinary: boolean) => void): this;
  on(
    event: "close",
    listener: (code?: number, reason?: ArrayBufferView | string) => void,
  ): this;
  on(event: "error", listener: (error: Error) => void): this;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  terminate?(): void;
}

export type WSMessageData =
  | ArrayBuffer
  | ArrayBufferView
  | readonly ArrayBufferView[];

export interface NodeIncomingMessage {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
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
  once?(event: "close", listener: () => void): this;
  off?(event: "close", listener: () => void): this;
  close(callback: (error?: Error) => void): void;
  closeAllConnections?(): void;
}

export interface WSWebSocketServer {
  readonly clients?: Iterable<WSWebSocket>;
  on(
    event: "headers",
    listener: (headers: string[], request: unknown) => void,
  ): this;
  close(callback?: (error?: Error) => void): void;
  handleUpgrade(
    request: unknown,
    socket: unknown,
    head: unknown,
    callback: (ws: WSWebSocket) => void,
  ): void;
  emit(event: string, ws: WSWebSocket, request: unknown): void;
}
