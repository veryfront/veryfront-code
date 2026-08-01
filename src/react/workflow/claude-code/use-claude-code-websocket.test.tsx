import "#veryfront/schemas/_test-setup.ts";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  useClaudeCodeWebSocket,
  type UseClaudeCodeWebSocketOptions,
  type UseClaudeCodeWebSocketState,
} from "./use-claude-code-websocket.ts";
import { admitClaudeCodeEventMessage } from "./event-protocol.ts";

type HookResult = UseClaudeCodeWebSocketState & {
  connect: () => void;
  disconnect: () => void;
  cancel: (reason?: string) => void;
  approve: (toolCallId: string, requestId: string) => void;
  reject: (toolCallId: string, requestId: string, reason?: string) => void;
  sendInput: (content: string) => void;
};

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readonly sent: string[] = [];
  readyState = FakeWebSocket.CONNECTING;
  closed = false;
  throwOnSend = false;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({} as Event);
  }

  message(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent);
  }

  emitClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.throwOnSend) throw new Error("transport send failed");
    this.sent.push(String(data));
  }

  close(): void {
    this.closed = true;
    this.readyState = FakeWebSocket.CLOSED;
  }
}

class FakeTimers {
  private nextId = 1;
  private callbacks = new Map<number, () => void>();
  private intervalCallbacks = new Map<number, () => void>();
  private intervalDelays = new Map<number, number>();

  readonly setTimeout = (handler: TimerHandler): number => {
    if (typeof handler !== "function") throw new Error("tests schedule function callbacks");
    const id = this.nextId++;
    this.callbacks.set(id, () => handler());
    return id;
  };

  readonly clearTimeout = (id: number | undefined): void => {
    if (id !== undefined) this.callbacks.delete(id);
  };

  readonly setInterval = (handler: TimerHandler, delay?: number): number => {
    if (typeof handler !== "function") throw new Error("tests schedule function callbacks");
    const id = this.nextId++;
    this.intervalCallbacks.set(id, () => handler());
    this.intervalDelays.set(id, delay ?? 0);
    return id;
  };

  readonly clearInterval = (id: number | undefined): void => {
    if (id === undefined) return;
    this.intervalCallbacks.delete(id);
    this.intervalDelays.delete(id);
  };

  get size(): number {
    return this.callbacks.size;
  }

  get activeIntervalDelays(): number[] {
    return [...this.intervalDelays.values()];
  }

  runAll(): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) callback();
  }
}

function installBrowser(): { restore: () => void; timers: FakeTimers } {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "https://example.test/",
  });
  const timers = new FakeTimers();
  const replacements: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    self: dom.window,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    WebSocket: FakeWebSocket,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of Object.keys(replacements)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: replacements[key],
      writable: true,
    });
  }

  return {
    timers,
    restore: () => {
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      }
      dom.window.close();
    },
  };
}

function mount(options: UseClaudeCodeWebSocketOptions) {
  let currentOptions = options;
  let latest: HookResult | null = null;
  const Capture = (): null => {
    latest = useClaudeCodeWebSocket(currentOptions);
    return null;
  };
  const root = createRoot(document.getElementById("root")!);
  flushSync(() => root.render(<Capture />));
  return {
    get: () => latest as HookResult,
    render(next: UseClaudeCodeWebSocketOptions): void {
      currentOptions = next;
      flushSync(() => root.render(<Capture />));
    },
    unmount(): void {
      flushSync(() => root.unmount());
    },
  };
}

function approvalRequest(toolCallId = "tool-1", runId = "run-1") {
  return {
    type: "approval_request",
    timestamp: 1,
    runId,
    requestId: `request-${toolCallId}`,
    toolCallId,
    toolName: "write",
    input: { path: "README.md" },
    reason: "writes a file",
  };
}

function inputRequest(requestId?: string) {
  return {
    type: "input_request",
    timestamp: 2,
    ...(requestId === undefined ? {} : { requestId }),
    prompt: "Continue?",
  };
}

describe("useClaudeCodeWebSocket transport ownership", () => {
  it("does not reconnect from a stale close after manual disconnect", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    try {
      const view = mount({ url: "wss://example.test/ws", runId: "run-1" });
      const first = FakeWebSocket.instances[0]!;
      const staleClose = first.onclose;

      flushSync(() => view.get().disconnect());
      flushSync(() => staleClose?.({} as CloseEvent));

      browser.timers.runAll();
      assertEquals(FakeWebSocket.instances.length, 1);

      flushSync(() => view.get().connect());
      assertEquals(FakeWebSocket.instances.length, 2);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("fences every transport callback after unmount", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    const events: unknown[] = [];
    const errors: Error[] = [];
    let connects = 0;
    let disconnects = 0;
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        onConnect: () => connects++,
        onDisconnect: () => disconnects++,
        onEvent: (event) => events.push(event),
        onError: (error) => errors.push(error),
      });
      const first = FakeWebSocket.instances[0]!;
      const callbacks = {
        close: first.onclose,
        error: first.onerror,
        message: first.onmessage,
        open: first.onopen,
      };

      view.unmount();
      callbacks.open?.({} as Event);
      callbacks.message?.({
        data: JSON.stringify({ type: "text_delta", timestamp: 1, content: "stale" }),
      } as MessageEvent);
      callbacks.error?.({} as Event);
      callbacks.close?.({} as CloseEvent);
      browser.timers.runAll();

      assertEquals(FakeWebSocket.instances.length, 1);
      assertEquals({ connects, disconnects, events: events.length, errors: errors.length }, {
        connects: 0,
        disconnects: 0,
        events: 0,
        errors: 0,
      });
    } finally {
      browser.restore();
    }
  });

  it("keeps option generations from closing or reviving the current socket", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    try {
      const stableOptions = {
        url: "wss://example.test/ws",
        runId: "run-1",
        pingInterval: 0,
      };
      const view = mount(stableOptions);
      const first = FakeWebSocket.instances[0]!;
      const staleClose = first.onclose;

      view.render({ ...stableOptions, runId: "run-2" });
      const second = FakeWebSocket.instances[1]!;
      assert(first.closed);

      staleClose?.({} as CloseEvent);
      browser.timers.runAll();

      assertEquals(FakeWebSocket.instances.length, 2);
      assertEquals(second.closed, false);
      assertStringIncludes(second.url, "runId=run-2");
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("replaces an open socket ping cadence when pingInterval changes", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        pingInterval: 1_000,
      });
      const socket = FakeWebSocket.instances[0]!;
      flushSync(() => socket.open());
      assertEquals(browser.timers.activeIntervalDelays, [1_000]);

      view.render({
        url: "wss://example.test/ws",
        runId: "run-1",
        pingInterval: 2_000,
      });

      assertEquals(browser.timers.activeIntervalDelays, [2_000]);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("disables an open socket ping when pingInterval becomes zero", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        pingInterval: 1_000,
      });
      const socket = FakeWebSocket.instances[0]!;
      flushSync(() => socket.open());
      assertEquals(browser.timers.activeIntervalDelays, [1_000]);

      view.render({
        url: "wss://example.test/ws",
        runId: "run-1",
        pingInterval: 0,
      });

      assertEquals(browser.timers.activeIntervalDelays, []);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("keeps reconnect scheduling single-flight", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        pingInterval: 0,
      });
      const first = FakeWebSocket.instances[0]!;

      first.emitClose();
      first.emitClose();

      assertEquals(browser.timers.size, 1);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("clears an owned transport error when a replacement socket opens", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        pingInterval: 0,
      });
      const first = FakeWebSocket.instances[0]!;
      flushSync(() => first.open());
      flushSync(() => first.onerror?.({} as Event));
      assertEquals(view.get().error, "WebSocket transport error");

      flushSync(() => first.emitClose());
      flushSync(() => browser.timers.runAll());
      const replacement = FakeWebSocket.instances[1]!;
      flushSync(() => replacement.open());

      assertEquals(view.get().isConnected, true);
      assertEquals(view.get().error, null);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("preserves protocol ownership even when its text matches a transport error", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        pingInterval: 0,
      });
      const first = FakeWebSocket.instances[0]!;
      flushSync(() => first.open());
      flushSync(() => first.onerror?.({} as Event));
      flushSync(() =>
        first.message({
          type: "error",
          timestamp: 1,
          runId: "run-1",
          message: "WebSocket transport error",
          recoverable: true,
        })
      );

      flushSync(() => first.emitClose());
      flushSync(() => browser.timers.runAll());
      const replacement = FakeWebSocket.instances[1]!;
      flushSync(() => replacement.open());

      assertEquals(view.get().isConnected, true);
      assertEquals(view.get().error, "WebSocket transport error");
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("preserves an onConnect callback error from the replacement socket", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    let connections = 0;
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        pingInterval: 0,
        onConnect: () => {
          connections += 1;
          if (connections === 2) throw new Error("consumer failed");
        },
      });
      const first = FakeWebSocket.instances[0]!;
      flushSync(() => first.open());
      flushSync(() => first.emitClose());
      flushSync(() => browser.timers.runAll());
      const replacement = FakeWebSocket.instances[1]!;
      flushSync(() => replacement.open());

      assertEquals(view.get().isConnected, true);
      assertEquals(view.get().error, "Claude Code onConnect callback failed");
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("does not let a reentrant disconnect replacement inherit a retired retry timer", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    let reconnectOnce: (() => void) | null = null;
    let disconnects = 0;
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        pingInterval: 0,
        onDisconnect: () => {
          disconnects += 1;
          const reconnect = reconnectOnce;
          reconnectOnce = null;
          reconnect?.();
        },
      });
      reconnectOnce = () => view.get().connect();
      const first = FakeWebSocket.instances[0]!;

      flushSync(() => first.emitClose());
      assertEquals(FakeWebSocket.instances.length, 2);
      assertEquals(browser.timers.size, 0);

      const replacement = FakeWebSocket.instances[1]!;
      flushSync(() => replacement.emitClose());
      assertEquals(browser.timers.size, 1);
      browser.timers.runAll();

      assertEquals(disconnects, 2);
      assertEquals(FakeWebSocket.instances.length, 3);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("preserves existing URL query and fragment components", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    try {
      const view = mount({
        url: "wss://example.test/ws?token=a#section",
        runId: "run 1",
        pingInterval: 0,
      });
      assertEquals(
        FakeWebSocket.instances[0]?.url,
        "wss://example.test/ws?token=a&runId=run+1#section",
      );
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("resets event and interaction state when the committed identity changes", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-a",
        pingInterval: 0,
      });
      const first = FakeWebSocket.instances[0]!;
      flushSync(() => {
        first.message({ type: "text_delta", timestamp: 1, content: "from-a" });
        first.message(approvalRequest("tool-a", "run-a"));
        first.message(inputRequest("request-a"));
      });
      assertEquals(view.get().pendingApprovals.length, 1);
      assertEquals(view.get().pendingInput?.requestId, "request-a");

      view.render({
        url: "wss://example.test/ws",
        runId: "run-b",
        pingInterval: 0,
      });
      assertEquals(view.get().text, "");
      assertEquals(view.get().error, null);
      assertEquals(view.get().pendingApprovals, []);
      assertEquals(view.get().pendingInput, null);
      assertEquals(view.get().isCancelled, false);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("bounds reconnects across repeated open-close flapping", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        maxReconnectAttempts: 2,
        pingInterval: 0,
      });
      for (let index = 0; index < 3; index++) {
        const socket = FakeWebSocket.instances[index]!;
        socket.open();
        socket.emitClose();
        browser.timers.runAll();
      }
      assertEquals(FakeWebSocket.instances.length, 3);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("clears interactions and never reconnects after a nonrecoverable error", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        pingInterval: 0,
      });
      const socket = FakeWebSocket.instances[0]!;
      const staleClose = socket.onclose;
      flushSync(() => {
        socket.message(approvalRequest());
        socket.message(inputRequest("request-1"));
        socket.message({
          type: "error",
          timestamp: 3,
          runId: "run-1",
          message: "terminal",
          recoverable: false,
        });
      });
      staleClose?.({} as CloseEvent);
      browser.timers.runAll();

      assertEquals(socket.closed, true);
      assertEquals(view.get().pendingApprovals, []);
      assertEquals(view.get().pendingInput, null);
      assertEquals(FakeWebSocket.instances.length, 1);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("revokes terminal ownership before completion callbacks can reconnect", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    try {
      let reconnectFromCallback = (): void => {};
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        pingInterval: 0,
        onComplete: () => reconnectFromCallback(),
      });
      reconnectFromCallback = () => view.get().connect();
      const socket = FakeWebSocket.instances[0]!;
      flushSync(() => socket.open());

      flushSync(() =>
        socket.message({
          type: "complete",
          timestamp: 1,
          runId: "run-1",
          result: {
            success: true,
            iterations: 1,
            filesModified: [],
            commandsExecuted: [],
            executionTime: 1,
          },
        })
      );

      assertEquals(socket.closed, true);
      assertEquals(FakeWebSocket.instances.length, 1);
      assertEquals(view.get().isConnected, false);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("permits a new connection after terminal ownership moves to another run", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        pingInterval: 0,
      });
      const first = FakeWebSocket.instances[0]!;
      flushSync(() => first.open());
      flushSync(() =>
        first.message({
          type: "complete",
          timestamp: 1,
          runId: "run-1",
          result: {
            success: true,
            iterations: 1,
            filesModified: [],
            commandsExecuted: [],
            executionTime: 1,
          },
        })
      );

      view.render({
        url: "wss://example.test/ws",
        runId: "run-2",
        pingInterval: 0,
      });

      assertEquals(FakeWebSocket.instances.length, 2);
      assertStringIncludes(FakeWebSocket.instances[1]!.url, "runId=run-2");
      assertEquals(FakeWebSocket.instances[1]!.closed, false);
      view.unmount();
    } finally {
      browser.restore();
    }
  });
});

describe("useClaudeCodeWebSocket delivery", () => {
  it("fails closed when secure command identity is unavailable or collides", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        pingInterval: 0,
      });
      const socket = FakeWebSocket.instances[0]!;
      flushSync(() => socket.open());
      flushSync(() => socket.message(approvalRequest()));

      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: undefined,
      });
      flushSync(() => view.get().approve("tool-1", "request-tool-1"));
      assertEquals(socket.sent, []);
      assertEquals(view.get().pendingApprovals.length, 1);
      assertStringIncludes(view.get().error ?? "", "secure command identity");

      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: { randomUUID: () => "fixed-command-id" },
      });
      flushSync(() => view.get().approve("tool-1", "request-tool-1"));
      assertEquals(socket.sent.length, 1);
      flushSync(() => view.get().cancel("stop"));
      assertEquals(socket.sent.length, 1);
      assertStringIncludes(view.get().error ?? "", "unique command identity");

      const approvalCommand = JSON.parse(socket.sent[0]!);
      flushSync(() =>
        socket.message({
          type: "command_ack",
          timestamp: 2,
          runId: "run-1",
          requestId: "request-tool-1",
          commandId: approvalCommand.commandId,
          commandType: "approve",
          status: "accepted",
        })
      );
      flushSync(() => view.get().cancel("still stop"));
      assertEquals(socket.sent.length, 1, "settled command identities remain collision-protected");
      assertStringIncludes(view.get().error ?? "", "unique command identity");
      view.unmount();
    } finally {
      if (cryptoDescriptor) Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
      else delete (globalThis as Record<string, unknown>).crypto;
      browser.restore();
    }
  });

  it("carries exact approval run and request identity through commands and acknowledgements", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        pingInterval: 0,
      });
      const socket = FakeWebSocket.instances[0]!;
      flushSync(() => socket.open());
      flushSync(() =>
        socket.message({
          ...approvalRequest(),
          runId: "run-2",
          requestId: "foreign-approval-request",
        })
      );
      assertEquals(view.get().pendingApprovals, []);
      flushSync(() =>
        socket.message({
          ...approvalRequest(),
          runId: "run-1",
          requestId: "approval-request-1",
        })
      );
      assertEquals(
        Reflect.set(view.get().pendingApprovals[0]!, "requestId", "mutated-request"),
        false,
      );

      flushSync(() => view.get().approve("tool-1", "approval-request-1"));
      const command = JSON.parse(socket.sent[0]!);
      assertEquals(command.runId, "run-1");
      assertEquals(command.requestId, "approval-request-1");
      assertEquals(view.get().pendingApprovals.length, 1);

      flushSync(() =>
        socket.message({
          type: "command_ack",
          timestamp: 2,
          runId: "run-2",
          requestId: "approval-request-1",
          commandId: command.commandId,
          commandType: "approve",
          status: "accepted",
        })
      );
      assertEquals(view.get().pendingApprovals.length, 1);

      flushSync(() =>
        socket.message({
          type: "command_ack",
          timestamp: 3,
          runId: "run-1",
          commandId: command.commandId,
          commandType: "approve",
          status: "accepted",
        })
      );
      assertEquals(view.get().pendingApprovals.length, 1);

      flushSync(() =>
        socket.message({
          type: "command_ack",
          timestamp: 4,
          runId: "run-1",
          requestId: "another-request",
          commandId: command.commandId,
          commandType: "approve",
          status: "accepted",
        })
      );
      assertEquals(view.get().pendingApprovals.length, 1);

      flushSync(() =>
        socket.message({
          type: "command_ack",
          timestamp: 5,
          runId: "run-1",
          requestId: "approval-request-1",
          commandId: command.commandId,
          commandType: "approve",
          status: "accepted",
        })
      );
      assertEquals(view.get().pendingApprovals, []);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("retains an approval until the socket accepts approve", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    const errors: Error[] = [];
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        autoReconnect: false,
        pingInterval: 0,
        onError: (error) => errors.push(error),
      });
      const socket = FakeWebSocket.instances[0]!;
      flushSync(() => socket.message(approvalRequest()));

      flushSync(() => view.get().approve("tool-1", "request-tool-1"));
      assertEquals(view.get().pendingApprovals.length, 1);
      assertEquals(errors.length, 1);
      assertStringIncludes(view.get().error ?? "", "not connected");

      flushSync(() => socket.open());
      const command = JSON.parse(socket.sent[0]!);
      assertEquals(view.get().pendingApprovals.length, 1);
      flushSync(() =>
        socket.message({
          type: "command_ack",
          timestamp: 3,
          runId: "run-1",
          requestId: "request-tool-1",
          commandId: command.commandId,
          commandType: "approve",
          status: "accepted",
        })
      );
      assertEquals(view.get().pendingApprovals, []);
      assertEquals(command.type, "approve");
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("retains a rejected approval when WebSocket.send throws", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    const errors: Error[] = [];
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        autoReconnect: false,
        pingInterval: 0,
        onError: (error) => errors.push(error),
      });
      const socket = FakeWebSocket.instances[0]!;
      flushSync(() => socket.open());
      flushSync(() => socket.message(approvalRequest()));
      socket.throwOnSend = true;

      let thrown: unknown = null;
      try {
        flushSync(() => view.get().reject("tool-1", "request-tool-1", "not now"));
      } catch (error) {
        thrown = error;
      }
      assertEquals(thrown, null, "delivery failures stay observable through hook state/callbacks");
      assertEquals(view.get().pendingApprovals.length, 1);
      assertEquals(errors.length, 1);
      assertStringIncludes(view.get().error ?? "", "send failed");
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("keys legacy input and retains it until an accepted acknowledgement", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        autoReconnect: false,
        pingInterval: 0,
      });
      const socket = FakeWebSocket.instances[0]!;
      flushSync(() => socket.message(inputRequest()));

      flushSync(() => view.get().sendInput("yes"));
      assertEquals(view.get().pendingInput?.prompt, "Continue?");

      flushSync(() => socket.open());
      flushSync(() => view.get().sendInput("yes"));
      const command = JSON.parse(socket.sent[0]!);
      assertEquals(command.type, "input");
      assertEquals(typeof command.commandId, "string");
      assertEquals("requestId" in command, false);
      assertEquals(view.get().pendingInput?.prompt, "Continue?");

      flushSync(() =>
        socket.message({
          type: "command_ack",
          timestamp: 3,
          runId: "run-1",
          commandId: command.commandId,
          commandType: "input",
          status: "accepted",
        })
      );
      assertEquals(view.get().pendingInput, null);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("resends the exact keyed approval command after reconnect until accepted", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        pingInterval: 0,
      });
      const first = FakeWebSocket.instances[0]!;
      flushSync(() => first.open());
      flushSync(() => first.message(approvalRequest()));
      flushSync(() => view.get().approve("tool-1", "request-tool-1"));
      const original = first.sent[0]!;
      const command = JSON.parse(original);
      assertEquals(typeof command.commandId, "string");
      assertEquals(view.get().pendingApprovals.length, 1);

      first.emitClose();
      browser.timers.runAll();
      const second = FakeWebSocket.instances[1]!;
      flushSync(() => second.open());
      assertEquals(second.sent[0], original);
      assertEquals(view.get().pendingApprovals.length, 1);

      flushSync(() =>
        second.message({
          type: "command_ack",
          timestamp: 3,
          runId: "run-1",
          requestId: "request-tool-1",
          commandId: command.commandId,
          commandType: "approve",
          status: "accepted",
        })
      );
      assertEquals(view.get().pendingApprovals, []);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("preserves a request after rejected ack and retries with a new command id", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        pingInterval: 0,
      });
      const socket = FakeWebSocket.instances[0]!;
      flushSync(() => socket.open());
      flushSync(() => socket.message(approvalRequest()));
      flushSync(() => view.get().reject("tool-1", "request-tool-1", "first"));
      const firstCommand = JSON.parse(socket.sent[0]!);

      flushSync(() =>
        socket.message({
          type: "command_ack",
          timestamp: 3,
          runId: "run-1",
          requestId: "request-tool-1",
          commandId: firstCommand.commandId,
          commandType: "reject",
          status: "rejected",
          reason: "stale decision",
        })
      );
      assertEquals(view.get().pendingApprovals.length, 1);
      assertStringIncludes(view.get().error ?? "", "stale decision");

      flushSync(() => view.get().reject("tool-1", "request-tool-1", "second"));
      const secondCommand = JSON.parse(socket.sent[1]!);
      assertEquals(secondCommand.commandId === firstCommand.commandId, false);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("correlates keyed input and clears it only after accepted ack", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        pingInterval: 0,
      });
      const socket = FakeWebSocket.instances[0]!;
      flushSync(() => socket.open());
      flushSync(() => socket.message(inputRequest("request-1")));
      flushSync(() => view.get().sendInput("yes"));
      const command = JSON.parse(socket.sent[0]!);
      assertEquals(command.requestId, "request-1");
      assertEquals(view.get().pendingInput?.requestId, "request-1");

      flushSync(() =>
        socket.message({
          type: "command_ack",
          timestamp: 3,
          runId: "run-1",
          commandId: command.commandId,
          commandType: "input",
          requestId: "request-1",
          status: "accepted",
        })
      );
      assertEquals(view.get().pendingInput, null);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("does not clear an unrelated server error when command delivery succeeds", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        pingInterval: 0,
      });
      const socket = FakeWebSocket.instances[0]!;
      flushSync(() => socket.open());
      flushSync(() =>
        socket.message({
          type: "error",
          timestamp: 1,
          message: "server warning",
          recoverable: true,
        })
      );
      flushSync(() => socket.message(approvalRequest()));
      flushSync(() => view.get().approve("tool-1", "request-tool-1"));

      assertEquals(view.get().error, "server warning");
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("rejects a command over the encoded wire limit before WebSocket.send", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        pingInterval: 0,
      });
      const socket = FakeWebSocket.instances[0]!;
      flushSync(() => socket.open());
      flushSync(() => socket.message(inputRequest("request-1")));

      flushSync(() => view.get().sendInput("€".repeat(32 * 1024)));

      assertEquals(socket.sent, []);
      assertEquals(view.get().pendingInput?.requestId, "request-1");
      assertStringIncludes(view.get().error ?? "", "byte limit");
      view.unmount();
    } finally {
      browser.restore();
    }
  });
});

describe("useClaudeCodeWebSocket protocol admission", () => {
  it("applies the canonical identity bound to optional event run IDs", () => {
    const admission = admitClaudeCodeEventMessage(JSON.stringify({
      type: "text_delta",
      timestamp: 1,
      runId: "x".repeat(257),
      content: "must not be admitted",
    }));

    assertEquals(admission.ok, false);
    if (!admission.ok) assertStringIncludes(admission.reason, "base fields");
  });

  it("rejects oversized text before attempting UTF-8 encoding", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    const OriginalTextEncoder = globalThis.TextEncoder;
    class BoundedTextEncoder extends OriginalTextEncoder {
      override encode(input?: string) {
        if ((input?.length ?? 0) > 64 * 1024) {
          throw new Error("oversized event reached TextEncoder");
        }
        return super.encode(input);
      }
    }
    Object.defineProperty(globalThis, "TextEncoder", {
      configurable: true,
      value: BoundedTextEncoder,
      writable: true,
    });
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        autoReconnect: false,
        pingInterval: 0,
      });
      const socket = FakeWebSocket.instances[0]!;
      flushSync(() =>
        socket.message({
          type: "text_delta",
          timestamp: 1,
          content: "x".repeat(64 * 1024),
        })
      );

      assertEquals(view.get().text, "");
      assertStringIncludes(view.get().error ?? "", "byte limit");
      view.unmount();
    } finally {
      Object.defineProperty(globalThis, "TextEncoder", {
        configurable: true,
        value: OriginalTextEncoder,
        writable: true,
      });
      browser.restore();
    }
  });

  it("requires exact own wire fields and snapshots approval input immutably", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    const requestIdDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "requestId");
    const runIdDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "runId");
    Object.defineProperty(Object.prototype, "requestId", {
      configurable: true,
      value: "prototype-request",
    });
    Object.defineProperty(Object.prototype, "runId", {
      configurable: true,
      value: "run-1",
    });
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        autoReconnect: false,
        pingInterval: 0,
      });
      const socket = FakeWebSocket.instances[0]!;
      flushSync(() =>
        socket.message({
          type: "approval_request",
          timestamp: 1,
          toolCallId: "tool-inherited",
          toolName: "write",
          input: {},
          reason: "missing own identity",
        })
      );
      flushSync(() => socket.message({ ...approvalRequest("tool-extra"), unexpected: true }));
      flushSync(() => socket.message(approvalRequest("x".repeat(257))));
      assertEquals(view.get().pendingApprovals, []);

      flushSync(() =>
        socket.message({
          ...approvalRequest("tool-safe"),
          input: { path: "README.md", nested: { values: [1, { safe: true }] } },
        })
      );
      const input = view.get().pendingApprovals[0]?.input;
      assert(input);
      assertEquals(Object.getPrototypeOf(input), null);
      assertEquals(Object.isFrozen(input), true);
      assertEquals(Object.getPrototypeOf(input.nested), null);
      assertEquals(Object.isFrozen(input.nested), true);
      const values = (input.nested as { values: unknown[] }).values;
      assertEquals(Object.isFrozen(values), true);
      assertEquals(Object.getPrototypeOf(values[1]!), null);
      assertEquals(Object.isFrozen(values[1]!), true);
      view.unmount();
    } finally {
      if (requestIdDescriptor) {
        Object.defineProperty(Object.prototype, "requestId", requestIdDescriptor);
      } else {
        delete (Object.prototype as Record<string, unknown>).requestId;
      }
      if (runIdDescriptor) Object.defineProperty(Object.prototype, "runId", runIdDescriptor);
      else delete (Object.prototype as Record<string, unknown>).runId;
      browser.restore();
    }
  });

  it("rejects malformed discriminated events before callbacks and reduction", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    const events: unknown[] = [];
    const errors: Error[] = [];
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        autoReconnect: false,
        pingInterval: 0,
        onEvent: (event) => events.push(event),
        onError: (error) => errors.push(error),
      });
      const socket = FakeWebSocket.instances[0]!;
      flushSync(() =>
        socket.message({ type: "text_delta", timestamp: 1, content: { nested: true } })
      );
      flushSync(() => socket.message({ type: "unknown", timestamp: 2 }));

      assertEquals(events, []);
      assertEquals(view.get().text, "");
      assertEquals(errors.length, 2);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("rejects explicitly misrouted events before state mutation", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-a",
        pingInterval: 0,
      });
      const socket = FakeWebSocket.instances[0]!;
      flushSync(() =>
        socket.message({
          type: "text_delta",
          timestamp: 1,
          runId: "run-b",
          content: "misrouted",
        })
      );

      assertEquals(view.get().text, "");
      assertStringIncludes(view.get().error ?? "", "runId does not match");
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("bounds pending approvals across 1,001 admitted requests", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        pingInterval: 0,
      });
      const socket = FakeWebSocket.instances[0]!;
      flushSync(() => {
        for (let index = 0; index <= 1_000; index++) {
          socket.message(approvalRequest(`tool-${index}`));
        }
      });

      assertEquals(view.get().pendingApprovals.length, 1_000);
      assertEquals(view.get().pendingApprovals[0]?.toolCallId, "tool-1");
      assertEquals(view.get().pendingApprovals.at(-1)?.toolCallId, "tool-1000");
      assertStringIncludes(view.get().error ?? "", "collection limit");
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("isolates reducer and interaction state from consumer callback mutation", () => {
    const browser = installBrowser();
    FakeWebSocket.instances = [];
    try {
      const view = mount({
        url: "wss://example.test/ws",
        runId: "run-1",
        pingInterval: 0,
        onEvent: (event) => {
          if (event.type === "tool_call_complete") event.input.path = "mutated";
        },
        onApprovalRequest: (approval) => {
          approval.input.path = "mutated approval";
        },
      });
      const socket = FakeWebSocket.instances[0]!;
      flushSync(() => {
        socket.message({
          type: "tool_call_complete",
          timestamp: 1,
          toolCallId: "tool-1",
          toolName: "read",
          input: { path: "safe.txt" },
        });
        socket.message(approvalRequest("tool-2"));
      });

      assertEquals(view.get().toolCalls[0]?.input, { path: "safe.txt" });
      assertEquals(view.get().pendingApprovals[0]?.input, { path: "README.md" });
      view.unmount();
    } finally {
      browser.restore();
    }
  });
});
