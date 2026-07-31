import "#veryfront/schemas/_test-setup.ts";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  useClaudeCodeStream,
  type UseClaudeCodeStreamOptions,
  type UseClaudeCodeStreamState,
} from "./use-claude-code-stream.ts";

type HookResult = UseClaudeCodeStreamState & {
  connect: () => void;
  disconnect: () => void;
};

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  open(): void {
    this.onopen?.({} as Event);
  }

  message(value: unknown): void {
    this.messageRaw(JSON.stringify(value));
  }

  messageRaw(data: string): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  emitError(): void {
    this.onerror?.({} as Event);
  }

  close(): void {
    this.closed = true;
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
    EventSource: FakeEventSource,
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

function mount(options: UseClaudeCodeStreamOptions) {
  let currentOptions = options;
  let latest: HookResult | null = null;
  const Capture = (): null => {
    latest = useClaudeCodeStream(currentOptions);
    return null;
  };
  const root = createRoot(document.getElementById("root")!);
  flushSync(() => root.render(<Capture />));
  return {
    get: () => latest as HookResult,
    render(next: UseClaudeCodeStreamOptions): void {
      currentOptions = next;
      flushSync(() => root.render(<Capture />));
    },
    unmount(): void {
      flushSync(() => root.unmount());
    },
  };
}

describe("useClaudeCodeStream transport ownership", () => {
  it("does not reconnect from a stale error after manual disconnect", () => {
    const browser = installBrowser();
    FakeEventSource.instances = [];
    try {
      const view = mount({ url: "/events", runId: "run-1" });
      const first = FakeEventSource.instances[0]!;
      const staleError = first.onerror;

      flushSync(() => view.get().disconnect());
      flushSync(() => staleError?.({} as Event));
      browser.timers.runAll();

      assertEquals(FakeEventSource.instances.length, 1);
      flushSync(() => view.get().connect());
      assertEquals(FakeEventSource.instances.length, 2);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("fences every EventSource callback after unmount", () => {
    const browser = installBrowser();
    FakeEventSource.instances = [];
    const events: unknown[] = [];
    const errors: Error[] = [];
    let connects = 0;
    let disconnects = 0;
    try {
      const view = mount({
        url: "/events",
        runId: "run-1",
        onConnect: () => connects++,
        onDisconnect: () => disconnects++,
        onEvent: (event) => events.push(event),
        onError: (error) => errors.push(error),
      });
      const first = FakeEventSource.instances[0]!;
      const callbacks = {
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
      browser.timers.runAll();

      assertEquals(FakeEventSource.instances.length, 1);
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

  it("keeps option generations from reviving an obsolete stream", () => {
    const browser = installBrowser();
    FakeEventSource.instances = [];
    try {
      const stableOptions = { url: "/events", runId: "run-1" };
      const view = mount(stableOptions);
      const first = FakeEventSource.instances[0]!;
      const staleError = first.onerror;

      view.render({ ...stableOptions, runId: "run-2" });
      const second = FakeEventSource.instances[1]!;
      assert(first.closed);

      staleError?.({} as Event);
      browser.timers.runAll();

      assertEquals(FakeEventSource.instances.length, 2);
      assertEquals(second.closed, false);
      assertStringIncludes(second.url, "runId=run-2");
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("closes a failed source and schedules one retry", () => {
    const browser = installBrowser();
    FakeEventSource.instances = [];
    try {
      const view = mount({
        url: "/events",
        runId: "run-1",
        onDisconnect: () => {
          throw new Error("consumer disconnect callback failed");
        },
      });
      const first = FakeEventSource.instances[0]!;

      first.emitError();
      first.emitError();
      assertEquals(first.closed, true);
      browser.timers.runAll();

      assertEquals(FakeEventSource.instances.length, 2);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("preserves existing URL query and fragment components", () => {
    const browser = installBrowser();
    FakeEventSource.instances = [];
    try {
      const view = mount({ url: "/events?token=a#section", runId: "run 1" });
      assertEquals(
        FakeEventSource.instances[0]?.url,
        "/events?token=a&runId=run+1#section",
      );
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("resets all event state when the committed stream identity changes", () => {
    const browser = installBrowser();
    FakeEventSource.instances = [];
    try {
      const view = mount({ url: "/events", runId: "run-a" });
      const first = FakeEventSource.instances[0]!;
      flushSync(() =>
        first.message({
          type: "text_delta",
          timestamp: 1,
          runId: "run-a",
          content: "from-a",
        })
      );
      flushSync(() =>
        first.message({
          type: "error",
          timestamp: 2,
          runId: "run-a",
          message: "recoverable-a",
          recoverable: true,
        })
      );
      assertEquals(view.get().text, "from-a");
      assertEquals(view.get().error, "recoverable-a");

      view.render({ url: "/events", runId: "run-b" });
      assertEquals(view.get().text, "");
      assertEquals(view.get().error, null);
      assertEquals(view.get().result, null);
      assertEquals(view.get().events, []);
      assertEquals(view.get().allToolCalls, []);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("bounds reconnects across repeated open-close flapping", () => {
    const browser = installBrowser();
    FakeEventSource.instances = [];
    try {
      const view = mount({
        url: "/events",
        runId: "run-1",
        maxReconnectAttempts: 2,
      });
      for (let index = 0; index < 3; index++) {
        const source = FakeEventSource.instances[index]!;
        source.open();
        source.emitError();
        browser.timers.runAll();
      }

      assertEquals(FakeEventSource.instances.length, 3);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("closes terminal streams and never reconnects after complete", () => {
    const browser = installBrowser();
    FakeEventSource.instances = [];
    try {
      const view = mount({ url: "/events", runId: "run-1" });
      const source = FakeEventSource.instances[0]!;
      const staleError = source.onerror;
      flushSync(() =>
        source.message({
          type: "complete",
          timestamp: 1,
          runId: "run-1",
          result: {
            success: true,
            iterations: 1,
            response: "done",
            filesModified: [],
            commandsExecuted: [],
            executionTime: 1,
          },
        })
      );
      staleError?.({} as Event);
      browser.timers.runAll();

      assertEquals(source.closed, true);
      assertEquals(view.get().isConnected, false);
      assertEquals(FakeEventSource.instances.length, 1);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("revokes terminal ownership before completion callbacks can reconnect", () => {
    const browser = installBrowser();
    FakeEventSource.instances = [];
    try {
      let reconnectFromCallback = (): void => {};
      const view = mount({
        url: "/events",
        runId: "run-1",
        onComplete: () => reconnectFromCallback(),
      });
      reconnectFromCallback = () => view.get().connect();
      const source = FakeEventSource.instances[0]!;

      flushSync(() =>
        source.message({
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

      assertEquals(source.closed, true);
      assertEquals(FakeEventSource.instances.length, 1);
      assertEquals(view.get().isConnected, false);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("retains event state when only autoConnect is toggled", () => {
    const browser = installBrowser();
    FakeEventSource.instances = [];
    try {
      const view = mount({ url: "/events", runId: "run-1", autoConnect: true });
      flushSync(() =>
        FakeEventSource.instances[0]!.message({
          type: "text_delta",
          timestamp: 1,
          content: "retained",
        })
      );

      view.render({ url: "/events", runId: "run-1", autoConnect: false });
      assertEquals(view.get().text, "retained");
      assertEquals(FakeEventSource.instances[0]?.closed, true);

      view.render({ url: "/events", runId: "run-1", autoConnect: true });
      assertEquals(view.get().text, "retained");
      assertEquals(FakeEventSource.instances.length, 2);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("cancels a scheduled retry when autoReconnect becomes false", () => {
    const browser = installBrowser();
    FakeEventSource.instances = [];
    try {
      const view = mount({
        url: "/events",
        runId: "run-1",
        autoReconnect: true,
      });
      FakeEventSource.instances[0]!.emitError();
      view.render({
        url: "/events",
        runId: "run-1",
        autoReconnect: false,
      });
      browser.timers.runAll();

      assertEquals(FakeEventSource.instances.length, 1);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("keeps terminal cleanup intact when completion callbacks throw", () => {
    const browser = installBrowser();
    FakeEventSource.instances = [];
    try {
      const view = mount({
        url: "/events",
        runId: "run-1",
        onEvent: () => {
          throw new Error("onEvent failed");
        },
        onComplete: () => {
          throw new Error("onComplete failed");
        },
      });
      const source = FakeEventSource.instances[0]!;
      const staleError = source.onerror;
      flushSync(() =>
        source.message({
          type: "complete",
          timestamp: 1,
          result: {
            success: true,
            iterations: 1,
            filesModified: [],
            commandsExecuted: [],
            executionTime: 1,
          },
        })
      );
      staleError?.({} as Event);
      browser.timers.runAll();

      assertEquals(source.closed, true);
      assertEquals(FakeEventSource.instances.length, 1);
      assertEquals(view.get().result?.success, true);
      view.unmount();
    } finally {
      browser.restore();
    }
  });
});

describe("useClaudeCodeStream protocol admission", () => {
  it("rejects malformed and WebSocket-only events before callbacks", () => {
    const browser = installBrowser();
    FakeEventSource.instances = [];
    const events: unknown[] = [];
    const errors: Error[] = [];
    try {
      const view = mount({
        url: "/events",
        runId: "run-1",
        autoReconnect: false,
        onEvent: (event) => events.push(event),
        onError: (error) => errors.push(error),
      });
      const source = FakeEventSource.instances[0]!;
      flushSync(() =>
        source.message({ type: "text_delta", timestamp: 1, content: { nested: true } })
      );
      flushSync(() => source.message({ type: "approval_request", timestamp: 2 }));

      assertEquals(events, []);
      assertEquals(view.get().text, "");
      assertEquals(errors.length, 2);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("rejects oversized event messages without retaining their contents", () => {
    const browser = installBrowser();
    FakeEventSource.instances = [];
    const events: unknown[] = [];
    const errors: Error[] = [];
    try {
      const view = mount({
        url: "/events",
        runId: "run-1",
        autoReconnect: false,
        onEvent: (event) => events.push(event),
        onError: (error) => errors.push(error),
      });
      const source = FakeEventSource.instances[0]!;
      source.messageRaw(JSON.stringify({
        type: "text_delta",
        timestamp: 1,
        content: "x".repeat(70_000),
      }));

      assertEquals(events, []);
      assertEquals(view.get().text, "");
      assertEquals(errors.length, 1);
      assertEquals(errors[0]?.message.includes("xxxxxxxx"), false);
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("rejects an admitted event explicitly addressed to another run", () => {
    const browser = installBrowser();
    FakeEventSource.instances = [];
    const errors: Error[] = [];
    try {
      const view = mount({
        url: "/events",
        runId: "run-a",
        autoReconnect: false,
        onError: (error) => errors.push(error),
      });
      flushSync(() =>
        FakeEventSource.instances[0]!.message({
          type: "text_delta",
          timestamp: 1,
          runId: "run-b",
          content: "misrouted",
        })
      );

      assertEquals(view.get().text, "");
      assertEquals(errors.length, 1);
      assertStringIncludes(view.get().error ?? "", "runId does not match");
      view.unmount();
    } finally {
      browser.restore();
    }
  });

  it("isolates reducer state from consumer callback mutation", () => {
    const browser = installBrowser();
    FakeEventSource.instances = [];
    try {
      const view = mount({
        url: "/events",
        runId: "run-1",
        autoReconnect: false,
        keepEventHistory: true,
        onEvent: (event) => {
          if (event.type === "text_delta") event.content = "x".repeat(2 * 1024 * 1024);
          if (event.type === "tool_call_complete") event.input.path = "mutated";
        },
        onComplete: (result) => {
          result.response = "mutated";
        },
      });
      const source = FakeEventSource.instances[0]!;
      flushSync(() => {
        source.message({ type: "text_delta", timestamp: 1, content: "safe" });
        source.message({
          type: "tool_call_complete",
          timestamp: 2,
          toolCallId: "tool-1",
          toolName: "read",
          input: { path: "safe.txt" },
        });
        source.message({
          type: "complete",
          timestamp: 3,
          result: {
            success: true,
            iterations: 1,
            response: "safe result",
            filesModified: [],
            commandsExecuted: [],
            executionTime: 1,
          },
        });
      });

      const firstEvent = view.get().events[0];
      assertEquals(view.get().text, "safe");
      assertEquals(firstEvent?.type, "text_delta");
      assertEquals(
        firstEvent?.type === "text_delta" ? firstEvent.content : null,
        "safe",
      );
      assertEquals(view.get().toolCalls[0]?.input, { path: "safe.txt" });
      assertEquals(view.get().result?.response, "safe result");
      view.unmount();
    } finally {
      browser.restore();
    }
  });
});
