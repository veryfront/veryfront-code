import type { WebSocketConnection } from "../../base.ts";

export interface DeferredWebSocketTransport {
  send(data: string | ArrayBuffer): void | number;
  close(code?: number, reason?: string): void;
  terminate?(): void;
}

type ListenerRegistration = {
  readonly once: boolean;
  readonly signal?: AbortSignal;
  abortListener?: () => void;
};

const nativeReportError = (
  globalThis as typeof globalThis & { reportError?: (error: unknown) => void }
).reportError;
const nativeQueueMicrotask = globalThis.queueMicrotask.bind(globalThis);

function reportUnhandledError(error: unknown): void {
  const normalized = error instanceof Error ? error : new Error(String(error));
  if (typeof nativeReportError === "function") {
    nativeReportError.call(globalThis, normalized);
    return;
  }
  nativeQueueMicrotask(() => {
    throw normalized;
  });
}

function createCloseEvent(code = 1006, reason = ""): CloseEvent {
  return Object.assign(new Event("close"), {
    code,
    reason,
    wasClean: code !== 1006,
  }) as CloseEvent;
}

function createErrorEvent(error: Error): ErrorEvent {
  return Object.assign(new Event("error"), {
    error,
    message: error.message,
    filename: "",
    lineno: 0,
    colno: 0,
  }) as ErrorEvent;
}

/**
 * EventTarget-compatible socket used while a native server transport finishes
 * its upgrade handshake. Runtime adapters attach exactly one native transport
 * and feed its lifecycle events into this bridge.
 */
export class DeferredWebSocket implements WebSocketConnection {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = DeferredWebSocket.CONNECTING;

  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  private transport: DeferredWebSocketTransport | null = null;
  private pendingClose: { code?: number; reason?: string } | null = null;
  private openDispatched = false;
  private closeDispatched = false;
  private readonly listeners = new Map<string, Map<EventListener, ListenerRegistration>>();

  constructor(private readonly runtimeName: string) {}

  protected attachTransport(transport: DeferredWebSocketTransport): void {
    if (this.transport) {
      transport.terminate?.();
      if (!transport.terminate) transport.close(1011, "Duplicate WebSocket transport");
      this.fail(new Error(`${this.runtimeName} attached more than one WebSocket transport`));
      return;
    }

    if (this.readyState === DeferredWebSocket.CLOSED) {
      transport.terminate?.();
      if (!transport.terminate) transport.close();
      return;
    }

    this.transport = transport;
    if (this.pendingClose) {
      const pendingClose = this.pendingClose;
      this.pendingClose = null;
      this.readyState = DeferredWebSocket.CLOSING;
      transport.close(pendingClose.code, pendingClose.reason);
      return;
    }

    this.readyState = DeferredWebSocket.OPEN;
    this.dispatchOpen();
  }

  protected emitMessage(data: unknown): void {
    if (this.readyState !== DeferredWebSocket.OPEN) return;
    this.dispatch("message", new MessageEvent("message", { data }));
  }

  protected emitClose(code = 1006, reason = ""): void {
    this.finishClose(createCloseEvent(code, reason));
  }

  protected emitTransportError(error: unknown): void {
    if (this.readyState === DeferredWebSocket.CLOSED) return;
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.dispatch("error", createErrorEvent(normalized));
  }

  protected fail(error: unknown): void {
    if (this.readyState === DeferredWebSocket.CLOSED) return;
    this.pendingClose = null;
    this.emitTransportError(error);
    try {
      this.transport?.terminate?.();
      if (this.transport && !this.transport.terminate) {
        this.transport.close(1011, "WebSocket transport failed");
      }
    } catch (closeError) {
      reportUnhandledError(closeError);
    }
    this.finishClose(createCloseEvent(1006, ""));
  }

  send(data: string | ArrayBuffer): void {
    if (this.transport && this.readyState === DeferredWebSocket.OPEN) {
      this.sendNow(data);
      return;
    }

    throw new DOMException(`${this.runtimeName} WebSocket is not open`, "InvalidStateError");
  }

  close(code?: number, reason?: string): void {
    if (
      this.readyState === DeferredWebSocket.CLOSING ||
      this.readyState === DeferredWebSocket.CLOSED
    ) {
      return;
    }

    this.readyState = DeferredWebSocket.CLOSING;
    if (!this.transport) {
      this.pendingClose = { code, reason };
      return;
    }
    this.transport.close(code, reason);
  }

  addEventListener(
    type: string,
    listener: EventListener,
    options: AddEventListenerOptions = {},
  ): void {
    if (options.signal?.aborted) return;

    let typeListeners = this.listeners.get(type);
    if (!typeListeners) {
      typeListeners = new Map();
      this.listeners.set(type, typeListeners);
    }
    if (typeListeners.has(listener)) return;

    const registration: ListenerRegistration = {
      once: options.once === true,
      signal: options.signal,
    };
    if (options.signal) {
      registration.abortListener = () => this.removeEventListener(type, listener);
      options.signal.addEventListener("abort", registration.abortListener, { once: true });
    }
    typeListeners.set(listener, registration);
  }

  removeEventListener(type: string, listener: EventListener): void {
    const typeListeners = this.listeners.get(type);
    const registration = typeListeners?.get(listener);
    if (!typeListeners || !registration) return;

    typeListeners.delete(listener);
    if (typeListeners.size === 0) this.listeners.delete(type);
    if (registration.signal && registration.abortListener) {
      registration.signal.removeEventListener("abort", registration.abortListener);
    }
  }

  private sendNow(data: string | ArrayBuffer): void {
    this.transport!.send(data);
  }

  private dispatchOpen(): void {
    if (this.openDispatched || this.readyState !== DeferredWebSocket.OPEN) return;
    this.openDispatched = true;
    this.dispatch("open", new Event("open"));
  }

  private finishClose(event: CloseEvent): void {
    if (this.closeDispatched) return;
    this.closeDispatched = true;
    this.readyState = DeferredWebSocket.CLOSED;
    this.pendingClose = null;
    this.dispatch("close", event);
    this.clearListeners();
  }

  private dispatch(type: string, event: Event): void {
    try {
      switch (type) {
        case "open":
          this.onopen?.call(this, event);
          break;
        case "close":
          this.onclose?.call(this, event as CloseEvent);
          break;
        case "error":
          this.onerror?.call(this, event);
          break;
        case "message":
          this.onmessage?.call(this, event as MessageEvent);
          break;
      }
    } catch (error) {
      reportUnhandledError(error);
    }

    const typeListeners = this.listeners.get(type);
    if (!typeListeners) return;
    for (const [listener, registration] of [...typeListeners]) {
      if (registration.once) this.removeEventListener(type, listener);
      try {
        listener.call(this, event);
      } catch (error) {
        reportUnhandledError(error);
      }
    }
  }

  private clearListeners(): void {
    for (const [type, listeners] of this.listeners) {
      for (const listener of listeners.keys()) this.removeEventListener(type, listener);
    }
  }
}
