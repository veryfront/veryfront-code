/**
 * Upstream WebSocket client for the proxy's renderer bridge.
 *
 * `new WebSocket(url)` cannot set request headers, so the bridge used to move
 * the tenant identity into the query string -- where the renderer, correctly,
 * refuses to read it. This client speaks the same handshake through
 * `WebSocketStream`, which does accept headers, so the bridge hop can carry the
 * exact identity headers every other proxied request carries.
 *
 * The surface is deliberately `WebSocket`-shaped (`readyState`, `send`,
 * `close`, `onopen`/`onmessage`/`onerror`/`onclose` receiving real DOM events)
 * so the bridge wiring in `main.ts` is unchanged by the transport swap.
 *
 * @module proxy/websocket-client
 */

/** The `opened` value of a WebSocketStream. */
export interface UpstreamWebSocketConnection {
  readonly readable: ReadableStream<string | Uint8Array>;
  readonly writable: WritableStream<string | Uint8Array>;
}

/** The subset of `WebSocketStream` this client depends on. */
export interface UpstreamWebSocketStream {
  readonly opened: Promise<UpstreamWebSocketConnection>;
  readonly closed: Promise<{ closeCode?: number; reason?: string }>;
  close(closeInfo?: { closeCode?: number; reason?: string }): void;
}

export type UpstreamWebSocketStreamFactory = (
  url: string,
  init: { headers: [string, string][] },
) => UpstreamWebSocketStream;

type WebSocketStreamGlobal = {
  WebSocketStream?: new (
    url: string,
    init: { headers: [string, string][] },
  ) => UpstreamWebSocketStream;
};

/**
 * Resolve the runtime's `WebSocketStream`.
 *
 * Fails loudly rather than falling back to `new WebSocket(url)`: a silent
 * fallback would drop the identity headers again and reproduce the 502 this
 * client exists to fix. The proxy binary is compiled with `--unstable-net`.
 */
export function resolveUpstreamWebSocketStreamFactory(): UpstreamWebSocketStreamFactory {
  const constructor = (globalThis as WebSocketStreamGlobal).WebSocketStream;
  if (typeof constructor !== "function") {
    throw new TypeError(
      "WebSocketStream is unavailable; the proxy requires --unstable-net to bridge WebSockets",
    );
  }
  return (url, init) => new constructor(url, init);
}

async function toChunk(
  data: string | ArrayBufferLike | ArrayBufferView | Blob,
): Promise<string | Uint8Array> {
  if (typeof data === "string") return data;
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(data as ArrayBuffer);
}

/** A `WebSocket`-shaped client that presents request headers on connect. */
export class UpstreamWebSocket {
  #stream: UpstreamWebSocketStream;
  #writer: WritableStreamDefaultWriter<string | Uint8Array> | null = null;
  #readyState: number = WebSocket.CONNECTING;
  #writes: Promise<void> = Promise.resolve();
  #settled = false;

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string | Uint8Array>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: URL | string, headers: Headers, factory: UpstreamWebSocketStreamFactory) {
    this.#stream = factory(url.toString(), { headers: [...headers] });
    this.#stream.opened.then(
      (connection) => this.#open(connection),
      (error: unknown) => this.#fail(error),
    );
    this.#stream.closed.then(
      (info) => this.#close(info.closeCode ?? 1005, info.reason ?? "", true),
      (error: unknown) => this.#fail(error),
    );
  }

  get readyState(): number {
    return this.#readyState;
  }

  send(data: string | ArrayBufferLike | ArrayBufferView | Blob): void {
    const writer = this.#writer;
    if (!writer || this.#readyState !== WebSocket.OPEN) return;
    // Chained so an awaited Blob conversion cannot reorder frames.
    this.#writes = this.#writes
      .then(async () => {
        await writer.write(await toChunk(data));
      })
      .catch((error: unknown) => this.#fail(error));
  }

  close(code?: number, reason?: string): void {
    if (this.#readyState === WebSocket.CLOSING || this.#readyState === WebSocket.CLOSED) return;
    this.#readyState = WebSocket.CLOSING;
    try {
      this.#stream.close(code === undefined ? undefined : { closeCode: code, reason });
    } catch {
      // Codes such as 1011 are reserved for endpoints and rejected by the
      // client close API. The bridge only wants the connection torn down.
      try {
        this.#stream.close();
      } catch {
        // Already closed by the peer.
      }
    }
  }

  #open(connection: UpstreamWebSocketConnection): void {
    if (this.#readyState !== WebSocket.CONNECTING) {
      // Closed while connecting; drop the connection we just inherited.
      connection.readable.cancel().catch(() => {});
      return;
    }
    this.#writer = connection.writable.getWriter();
    this.#readyState = WebSocket.OPEN;
    this.onopen?.(new Event("open"));
    this.#pump(connection.readable);
  }

  async #pump(readable: ReadableStream<string | Uint8Array>): Promise<void> {
    const reader = readable.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        this.onmessage?.(new MessageEvent("message", { data: value }));
      }
    } catch (error) {
      this.#fail(error);
    } finally {
      reader.releaseLock();
    }
  }

  #fail(error: unknown): void {
    if (this.#settled) return;
    const message = error instanceof Error ? error.message : String(error);
    this.onerror?.(new ErrorEvent("error", { message }));
    this.#close(1006, message, false);
  }

  #close(code: number, reason: string, wasClean: boolean): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#readyState = WebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close", { code, reason, wasClean }));
  }
}

export function connectUpstreamWebSocket(
  url: URL | string,
  headers: Headers,
  factory: UpstreamWebSocketStreamFactory = resolveUpstreamWebSocketStreamFactory(),
): UpstreamWebSocket {
  return new UpstreamWebSocket(url, headers, factory);
}
