export type {
  NodeWebSocketConnection as WSWebSocket,
  NodeWebSocketMessageData as WSMessageData,
  NodeWebSocketServer as WSWebSocketServer,
} from "#veryfront/extensions/websocket";

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
