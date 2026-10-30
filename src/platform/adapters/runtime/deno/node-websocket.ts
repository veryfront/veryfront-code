import { types as nodeUtilTypes } from "node:util";
import { NodeServerAdapter, NodeWebSocket } from "../node/websocket-adapter.ts";
import type { HttpHandlerResponse, WebSocketUpgradeOptions } from "../../base.ts";
import { recordDenoWebSocketResponse } from "../shared/http-upgrade-provenance.ts";

const isSharedArrayBuffer = nodeUtilTypes.isSharedArrayBuffer;

/** DOM surface retained by Deno when its HTTP listener uses Node transport. */
export class DenoNodeWebSocket extends EventTarget implements WebSocket {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readonly url = "";
  readonly protocol = "";
  readonly extensions = "";
  private binary: BinaryType = "arraybuffer";
  private readonly sendQueue: Array<string | ArrayBuffer | Blob> = [];
  private sending = false;
  private pendingSendBytes = 0;
  private queuedClose?: { code?: number; reason?: string };

  private openHandler: WebSocket["onopen"] = null;
  private readonly openListener: EventListener = (event) => {
    this.openHandler?.call(this, event as Event);
  };
  get onopen(): WebSocket["onopen"] {
    return this.openHandler;
  }
  set onopen(callback: WebSocket["onopen"]) {
    this.updateHandler("open", this.openHandler !== null, callback !== null, this.openListener);
    this.openHandler = callback;
  }
  private closeHandler: WebSocket["onclose"] = null;
  private readonly closeListener: EventListener = (event) => {
    this.closeHandler?.call(this, event as CloseEvent);
  };
  get onclose(): WebSocket["onclose"] {
    return this.closeHandler;
  }
  set onclose(callback: WebSocket["onclose"]) {
    this.updateHandler("close", this.closeHandler !== null, callback !== null, this.closeListener);
    this.closeHandler = callback;
  }
  private errorHandler: WebSocket["onerror"] = null;
  private readonly errorListener: EventListener = (event) => {
    this.errorHandler?.call(this, event as Event);
  };
  get onerror(): WebSocket["onerror"] {
    return this.errorHandler;
  }
  set onerror(callback: WebSocket["onerror"]) {
    this.updateHandler("error", this.errorHandler !== null, callback !== null, this.errorListener);
    this.errorHandler = callback;
  }
  private messageHandler: WebSocket["onmessage"] = null;
  private readonly messageListener: EventListener = (event) => {
    this.messageHandler?.call(this, event as MessageEvent);
  };
  get onmessage(): WebSocket["onmessage"] {
    return this.messageHandler;
  }
  set onmessage(callback: WebSocket["onmessage"]) {
    this.updateHandler(
      "message",
      this.messageHandler !== null,
      callback !== null,
      this.messageListener,
    );
    this.messageHandler = callback;
  }
  constructor(private readonly inner: NodeWebSocket) {
    super();
    inner.addEventListener("open", () => this.deliver(new Event("open")));
    inner.addEventListener("close", (event) => {
      this.sendQueue.length = 0;
      this.pendingSendBytes = 0;
      const close = event as CloseEvent;
      this.deliver(
        new CloseEvent("close", {
          code: close.code,
          reason: close.reason,
          wasClean: close.wasClean,
        }),
      );
    });
    inner.addEventListener("error", (event) => {
      const error = event as ErrorEvent;
      this.deliver(new ErrorEvent("error", { message: error.message, error: error.error }));
    });
    inner.addEventListener("message", (event) => {
      const data: unknown = (event as MessageEvent).data;
      this.deliver(
        new MessageEvent("message", {
          data: data instanceof ArrayBuffer && this.binary === "blob" ? new Blob([data]) : data,
        }),
      );
    });
  }

  get readyState(): WebSocket["readyState"] {
    const state = this.inner.readyState;
    if (state === this.OPEN && this.queuedClose) return this.CLOSING;
    if (state === 0 || state === 1 || state === 2 || state === 3) return state;
    throw new TypeError("Invalid WebSocket transport state");
  }
  get bufferedAmount(): number {
    return this.readyState === this.OPEN
      ? this.pendingSendBytes + this.inner._getBufferedAmount()
      : 0;
  }
  get binaryType(): BinaryType {
    return this.binary;
  }
  set binaryType(value: BinaryType) {
    if (value === "blob" || value === "arraybuffer") this.binary = value;
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView<ArrayBufferLike>): void {
    if (arguments.length === 0) throw new TypeError("WebSocket.send requires an argument");
    if (this.readyState === this.CONNECTING) {
      throw new DOMException("'readyState' not OPEN", "InvalidStateError");
    }
    if (this.readyState !== this.OPEN) return;
    let normalized: string | ArrayBuffer | Blob;
    if (typeof data === "string" || data instanceof Blob) normalized = data;
    else if (ArrayBuffer.isView(data)) {
      normalized = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice().buffer;
    } else if (isSharedArrayBuffer(data)) normalized = new Uint8Array(data).slice().buffer;
    else if (data instanceof ArrayBuffer) normalized = data.slice(0);
    else normalized = String(data);
    if (!this.sending && !(normalized instanceof Blob)) {
      this.inner.send(normalized);
      return;
    }
    this.pendingSendBytes += this.sendByteLength(normalized);
    this.sendQueue.push(normalized);
    if (!this.sending) void this.flushSends();
  }

  close(code?: number, reason?: string): void {
    if (code !== undefined) {
      const value = Number(code);
      const clamped = Number.isNaN(value) ? 0 : Math.min(65535, Math.max(0, value));
      const lower = Math.floor(clamped);
      code = clamped - lower === 0.5 ? lower + (lower % 2) : Math.round(clamped);
      // Native Deno permits malformed server close frames. Preserve valid
      // protocol inputs while retaining the provider's synchronous RFC guard.
      if (
        !((code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)) ||
          (code >= 3000 && code <= 4999))
      ) {
        throw new TypeError("WebSocket close code must be a valid protocol status code");
      }
    }
    if (reason !== undefined) {
      if (typeof reason === "symbol") {
        throw new TypeError("A WebSocket close reason must be a string");
      }
      reason = String(reason).toWellFormed();
    }
    if (reason !== undefined && new TextEncoder().encode(reason).length > 123) {
      throw new DOMException("The close reason may not be longer than 123 bytes", "SyntaxError");
    }
    if (this.readyState === this.CLOSING || this.readyState === this.CLOSED) return;
    if (this.sending && this.readyState === this.OPEN) {
      this.queuedClose = { code, reason };
      return;
    }
    this.inner.close(code, reason);
  }

  private async flushSends(): Promise<void> {
    this.sending = true;
    try {
      while (this.sendQueue.length > 0) {
        const item = this.sendQueue.shift()!;
        const data = item instanceof Blob ? await item.slice().arrayBuffer() : item;
        if (this.inner.readyState !== this.OPEN) break;
        this.pendingSendBytes -= this.sendByteLength(item);
        this.inner.send(data);
      }
    } catch (error) {
      this.pendingSendBytes = 0;
      this.inner._emitError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.sendQueue.length = 0;
      this.pendingSendBytes = 0;
      this.sending = false;
      const close = this.queuedClose;
      this.queuedClose = undefined;
      if (close) {
        try {
          this.inner.close(close.code, close.reason);
        } catch (error) {
          this.inner._emitError(error instanceof Error ? error : new Error(String(error)));
        }
      }
    }
  }

  private sendByteLength(data: string | ArrayBuffer | Blob): number {
    if (typeof data === "string") return new TextEncoder().encode(data).byteLength;
    return data instanceof Blob ? data.size : data.byteLength;
  }

  private updateHandler(
    type: string,
    previous: boolean,
    next: boolean,
    listener: EventListener,
  ): void {
    if (!previous && next) this.addEventListener(type, listener);
    else if (previous && !next) this.removeEventListener(type, listener);
  }

  private deliver(event: Event): void {
    this.dispatchEvent(event);
  }
}

export function upgradeDenoNodeWebSocket(
  request: Request,
  options?: WebSocketUpgradeOptions,
): { socket: WebSocket; response: HttpHandlerResponse } {
  const upgrade = new NodeServerAdapter(true).upgradeWebSocket(request, options);
  if (!(upgrade.socket instanceof NodeWebSocket)) {
    throw new TypeError("Deno WebSocket transport did not create its owned socket");
  }
  recordDenoWebSocketResponse(upgrade.response);
  return { socket: new DenoNodeWebSocket(upgrade.socket), response: upgrade.response };
}
