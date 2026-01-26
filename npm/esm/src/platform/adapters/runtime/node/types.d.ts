export interface WSWebSocket extends EventTarget {
    on(event: "open", listener: () => void): this;
    on(event: "message", listener: (data: WSMessageData) => void): this;
    on(event: "close", listener: () => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    send(data: string | ArrayBuffer): void;
    close(code?: number, reason?: string): void;
}
export interface WSMessageData {
    toString(): string;
}
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
    close(callback: () => void): void;
}
export interface WSWebSocketServer {
    close(): void;
    handleUpgrade(request: unknown, socket: unknown, head: unknown, callback: (ws: WSWebSocket) => void): void;
    emit(event: string, ws: WSWebSocket, request: unknown): void;
}
//# sourceMappingURL=types.d.ts.map