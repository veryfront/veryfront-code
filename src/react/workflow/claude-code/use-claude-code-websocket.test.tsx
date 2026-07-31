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

type HookResult = UseClaudeCodeWebSocketState & {
  connect: () => void;
  disconnect: () => void;
  cancel: (reason?: string) => void;
  approve: (toolCallId: string) => void;
  reject: (toolCallId: string, reason?: string) => void;
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

  readonly setTimeout = (handler: TimerHandler): number => {
    if (typeof handler !== "function") throw new Error("tests schedule function callbacks");
    const id = this.nextId++;
    this.callbacks.set(id, () => handler());
    return id;
  };

  readonly clearTimeout = (id: number | undefined): void => {
    if (id !== undefined) this.callbacks.delete(id);
  };

  get size(): number {
    return this.callbacks.size;
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

function approvalRequest(toolCallId = "tool-1") {
  return {
    type: "approval_request",
    timestamp: 1,
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
        first.message(approvalRequest("tool-a"));
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
});

describe("useClaudeCodeWebSocket delivery", () => {
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

      flushSync(() => view.get().approve("tool-1"));
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
        flushSync(() => view.get().reject("tool-1", "not now"));
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
      flushSync(() => view.get().approve("tool-1"));
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
      flushSync(() => view.get().reject("tool-1", "first"));
      const firstCommand = JSON.parse(socket.sent[0]!);

      flushSync(() =>
        socket.message({
          type: "command_ack",
          timestamp: 3,
          runId: "run-1",
          commandId: firstCommand.commandId,
          commandType: "reject",
          status: "rejected",
          reason: "stale decision",
        })
      );
      assertEquals(view.get().pendingApprovals.length, 1);
      assertStringIncludes(view.get().error ?? "", "stale decision");

      flushSync(() => view.get().reject("tool-1", "second"));
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
      flushSync(() => view.get().approve("tool-1"));

      assertEquals(view.get().error, "server warning");
      view.unmount();
    } finally {
      browser.restore();
    }
  });
});

describe("useClaudeCodeWebSocket protocol admission", () => {
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
