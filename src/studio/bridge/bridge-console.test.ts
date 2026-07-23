import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildRuntimeErrorDetails,
  disposeConsoleCapture,
  disposeErrorHandling,
  formatConsoleValue,
  safeRejectionMessage,
  setupConsoleCapture,
  setupErrorHandling,
} from "./bridge-console.ts";
import { MessageFromRendererSchema } from "../schemas/studio.schema.ts";
import { CONSOLE_METHODS, state } from "./bridge-state.ts";
import {
  _flushPendingForTest,
  _pendingCountForTest,
  _resetForTest,
  isFromStudio,
} from "./bridge-messaging.ts";

interface RuntimeWindowHarness {
  listeners: Map<string, Set<EventListener>>;
  parent: {
    postMessage(message: unknown, targetOrigin: string): void;
  };
  posted: Array<{ message: unknown; targetOrigin: string }>;
  window: {
    addEventListener(type: string, listener: EventListener): void;
    location: { href: string };
    parent: RuntimeWindowHarness["parent"];
    removeEventListener(type: string, listener: EventListener): void;
  };
}

function createRuntimeWindowHarness(): RuntimeWindowHarness {
  const listeners = new Map<string, Set<EventListener>>();
  const posted: RuntimeWindowHarness["posted"] = [];
  const parent = {
    postMessage(message: unknown, targetOrigin: string) {
      posted.push({ message, targetOrigin });
    },
  };
  return {
    listeners,
    parent,
    posted,
    window: {
      addEventListener(type: string, listener: EventListener) {
        const registered = listeners.get(type) ?? new Set<EventListener>();
        registered.add(listener);
        listeners.set(type, registered);
      },
      location: {
        href: "https://preview.example/page?token=<TOKEN>#private",
      },
      parent,
      removeEventListener(type: string, listener: EventListener) {
        listeners.get(type)?.delete(listener);
      },
    },
  };
}

function getRuntimeListener<T extends Event>(
  harness: RuntimeWindowHarness,
  type: string,
): (event: T) => void {
  const listener = harness.listeners.get(type)?.values().next().value;
  if (typeof listener !== "function") throw new Error(`Missing ${type} listener`);
  return listener as (event: T) => void;
}

function studioHandshakeEvent(harness: RuntimeWindowHarness): MessageEvent {
  return {
    data: {},
    origin: "https://studio.veryfront.com",
    ports: [],
    source: harness.parent,
  } as unknown as MessageEvent;
}

describe("studio/bridge/bridge-console", () => {
  it("marks arbitrary objects as opaque without executing getters or toJSON", () => {
    let getterCalls = 0;
    let toJsonCalls = 0;
    const value = Object.defineProperties({}, {
      safe: { value: "value", enumerable: true },
      unsafe: {
        enumerable: true,
        get() {
          getterCalls++;
          return "unsafe";
        },
      },
      toJSON: {
        enumerable: false,
        value() {
          toJsonCalls++;
          return { unsafe: true };
        },
      },
    });

    assertEquals(formatConsoleValue(value), { __isOpaqueObject: true });
    assertEquals(getterCalls, 0);
    assertEquals(toJsonCalls, 0);
  });

  it("contains circular and oversized console values", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    assertEquals(formatConsoleValue(circular), { __isOpaqueObject: true });
    const long = formatConsoleValue("x".repeat(70_000));
    assertEquals(typeof long, "string");
    assertEquals((long as string).length <= 65_536, true);
  });

  it("redacts credentials and local paths from forwarded diagnostics", () => {
    const diagnostic = "authorization: Bearer <TOKEN>\n    at file:///%3CREDACTED%3E/source.ts:1:1";
    const formattedString = formatConsoleValue(diagnostic) as string;
    const rejectionMessage = safeRejectionMessage(diagnostic);
    const error = new Error("authorization: Bearer <TOKEN>");
    error.stack = diagnostic;
    const formattedError = formatConsoleValue(error) as Record<string, unknown>;
    const runtimeError = buildRuntimeErrorDetails({ message: diagnostic });

    for (
      const value of [
        formattedString,
        rejectionMessage,
        formattedError.message,
        formattedError.stack,
        runtimeError.message,
      ]
    ) {
      assertEquals(typeof value, "string");
      assertEquals((value as string).includes("<TOKEN>"), false);
      assertEquals((value as string).includes("file:///"), false);
    }
    assertEquals(formattedString.includes("[REDACTED]"), true);
    assertEquals(formattedString.includes("<LOCAL_PATH>"), true);
  });

  it("redacts Windows UNC and device paths from forwarded diagnostics", () => {
    const diagnostic = String
      .raw`Failure at \\example.invalid\share\project\source.ts:1:1 and \\?\C:\project\source.ts:2:2`;
    const error = new Error(diagnostic);
    error.stack = diagnostic;

    const forwarded = [
      formatConsoleValue(diagnostic),
      safeRejectionMessage(diagnostic),
      (formatConsoleValue(error) as Record<string, unknown>).message,
      (formatConsoleValue(error) as Record<string, unknown>).stack,
      buildRuntimeErrorDetails({ message: diagnostic }).message,
    ];

    for (const value of forwarded) {
      assertEquals(value, "Failure at <LOCAL_PATH> and <LOCAL_PATH>");
    }
  });

  it("does not coerce hostile rejection reasons", () => {
    let conversionCalls = 0;
    const reason = {
      toString() {
        conversionCalls++;
        return "unsafe";
      },
    };

    assertEquals(safeRejectionMessage(reason), "Unhandled promise rejection");
    assertEquals(conversionCalls, 0);
  });

  it("contains revoked proxy console values", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    assertEquals(formatConsoleValue(proxy), { __isOpaqueObject: true });
    assertEquals(safeRejectionMessage(proxy), "Unhandled promise rejection");
  });

  it("does not execute proxy traps while formatting console values", () => {
    let trapCalls = 0;
    const proxy = new Proxy({}, {
      getPrototypeOf(target) {
        trapCalls++;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        trapCalls++;
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, property) {
        trapCalls++;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });

    assertEquals(formatConsoleValue(proxy), { __isOpaqueObject: true });
    assertEquals(safeRejectionMessage(proxy), "Unhandled promise rejection");
    assertEquals(trapCalls, 0);
  });

  it("preserves native Error diagnostics through the side-effect-free brand check", () => {
    const error = new Error("capture failed");
    error.name = "CaptureError";

    const formatted = formatConsoleValue(error) as Record<string, unknown>;
    assertEquals(formatted.__isError, true);
    assertEquals(formatted.name, "CaptureError");
    assertEquals(formatted.message, "capture failed");
    assertEquals(typeof formatted.stack, "string");
    assertEquals(safeRejectionMessage(error), "capture failed");

    let trapCalls = 0;
    const proxiedError = new Proxy(error, {
      getPrototypeOf(target) {
        trapCalls++;
        return Reflect.getPrototypeOf(target);
      },
      getOwnPropertyDescriptor(target, property) {
        trapCalls++;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    assertEquals(formatConsoleValue(proxiedError), { __isOpaqueObject: true });
    assertEquals(safeRejectionMessage(proxiedError), "Unhandled promise rejection");
    assertEquals(trapCalls, 0);
  });

  it("normalizes runtime error events to the renderer schema", () => {
    const details = buildRuntimeErrorDetails({
      message: "m".repeat(70_000),
      filename: "f".repeat(5_000),
      lineno: 0,
      colno: 0,
    });

    assertEquals(details.message.length <= 65_536, true);
    assertEquals(details.file?.length, 4_096);
    assertEquals("line" in details, false);
    assertEquals(details.column, 0);
    assertEquals(
      MessageFromRendererSchema.safeParse({
        action: "runtimeError",
        url: "https://preview.example/page",
        errors: [details],
      }).success,
      true,
    );

    const remote = buildRuntimeErrorDetails({
      message: "failed",
      filename: "https://preview.example/source.ts?token=<TOKEN>#private",
    });
    assertEquals(remote.file, "https://preview.example/source.ts");
    assertEquals(
      "file" in buildRuntimeErrorDetails({
        message: "failed",
        filename: "file:///<REDACTED>/source.ts",
      }),
      false,
    );
    assertEquals(
      "file" in buildRuntimeErrorDetails({
        message: "failed",
        filename: String.raw`\\server\share\source.ts`,
      }),
      false,
    );
    assertEquals(
      "file" in buildRuntimeErrorDetails({
        message: "failed",
        filename: String.raw`\rooted\source.ts`,
      }),
      false,
    );
  });

  it("preserves safe runtime source paths without leaking URL secrets", () => {
    for (
      const [filename, expected] of [
        ["app/page.tsx", "app/page.tsx"],
        ["docs/日本語/e\u0301tude.ts", "docs/日本語/e\u0301tude.ts"],
        ["components/😀-按钮.tsx?token=<TOKEN>#private", "components/😀-按钮.tsx"],
        [
          "https://preview.example/docs/%E6%97%A5%E6%9C%AC%E8%AA%9E.ts?token=<TOKEN>#private",
          "https://preview.example/docs/%E6%97%A5%E6%9C%AC%E8%AA%9E.ts",
        ],
      ] as const
    ) {
      assertEquals(buildRuntimeErrorDetails({ message: "failed", filename }).file, expected);
    }
  });

  it("rejects unsafe runtime source paths", () => {
    for (
      const filename of [
        "../private/source.ts",
        "app/../../private/source.ts",
        "app/%2e%2e/private/source.ts",
        "app/%252e%252e/private/source.ts",
        "app/%2fprivate/source.ts",
        "app/%255cprivate/source.ts",
        "/private/workspace/source.ts",
        "C:/Users/example/project/source.ts",
        String.raw`C:\Users\example\project\source.ts`,
        String.raw`\\server\share\source.ts`,
        String.raw`\\?\C:\project\source.ts`,
        "app/source\nts",
        "app/source\u0085ts",
        "app/source\u061cts",
        "app/source\u202ets",
        "app/%E2%80%AEsource.ts",
        "app/source\ud800ts",
        "https://user:secret@preview.example/source.ts",
        "https://preview.example/app/../private/source.ts",
        "https://preview.example/app/%2e%2e/private/source.ts",
        "https://preview.example/app/%252e%252e/private/source.ts",
        "https://preview.example/app/%2fprivate/source.ts",
        "file:///private/workspace/source.ts",
        "javascript:alert(1)",
        "data:text/plain,source.ts",
      ]
    ) {
      assertEquals(
        "file" in buildRuntimeErrorDetails({ message: "failed", filename }),
        false,
        filename,
      );
    }
  });

  it("installs console capture once and restores only owned wrappers", () => {
    const originalConsole = globalThis.console;
    const originalWindow = globalThis.window;
    const calls: unknown[][] = [];
    const fakeConsole = Object.fromEntries(
      CONSOLE_METHODS.map((
        method,
      ) => [method, (...args: unknown[]) => calls.push([method, ...args])]),
    );
    const fakeWindow = { parent: null as unknown };
    fakeWindow.parent = fakeWindow;
    Object.defineProperty(globalThis, "console", { value: fakeConsole, configurable: true });
    Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
    try {
      setupConsoleCapture();
      const wrapper = fakeConsole.log;
      setupConsoleCapture();
      assertEquals(fakeConsole.log, wrapper);

      fakeConsole.log!("hello");
      assertEquals(calls, [["log", "hello"]]);

      disposeConsoleCapture();
      assertEquals(fakeConsole.log === wrapper, false);
    } finally {
      disposeConsoleCapture();
      Object.defineProperty(globalThis, "console", { value: originalConsole, configurable: true });
      Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
    }
  });

  it("leaves later console wrappers intact and makes disposed wrappers inert", () => {
    const originalConsole = globalThis.console;
    const originalWindow = globalThis.window;
    const calls: unknown[][] = [];
    const fakeConsole = Object.fromEntries(
      CONSOLE_METHODS.map((method) => [
        method,
        (...args: unknown[]) => calls.push([method, ...args]),
      ]),
    );
    const fakeWindow = { parent: { postMessage() {} } };
    Object.defineProperty(globalThis, "console", { value: fakeConsole, configurable: true });
    Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
    try {
      _resetForTest();
      setupConsoleCapture();
      const firstStudioWrapper = fakeConsole.log!;
      const thirdPartyWrapper = (...args: unknown[]) => firstStudioWrapper(...args);
      fakeConsole.log = thirdPartyWrapper;

      disposeConsoleCapture();
      assertEquals(fakeConsole.log, thirdPartyWrapper);
      fakeConsole.log("after dispose");
      assertEquals(_pendingCountForTest(), 0);

      setupConsoleCapture();
      fakeConsole.log("after re-init");
      assertEquals(_pendingCountForTest(), 1);

      disposeConsoleCapture();
      assertEquals(fakeConsole.log, thirdPartyWrapper);
      assertEquals(calls, [
        ["log", "after dispose"],
        ["log", "after re-init"],
      ]);
    } finally {
      disposeConsoleCapture();
      _resetForTest();
      Object.defineProperty(globalThis, "console", { value: originalConsole, configurable: true });
      Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
    }
  });

  it("forwards bounded, schema-valid runtime callbacks and hides active overlays", () => {
    const originalWindow = globalThis.window;
    const originalHoverOverlay = state.hoverOverlay;
    const originalSelectionOverlay = state.selectionOverlay;
    const harness = createRuntimeWindowHarness();
    const hoverOverlay = { style: { display: "block" } } as unknown as HTMLElement;
    const selectionOverlay = { style: { display: "block" } } as unknown as HTMLElement;
    Object.defineProperty(globalThis, "window", {
      value: harness.window,
      configurable: true,
    });
    state.hoverOverlay = hoverOverlay;
    state.selectionOverlay = selectionOverlay;

    try {
      _resetForTest();
      setupErrorHandling();
      const errorListener = getRuntimeListener<ErrorEvent>(harness, "error");
      const rejectionListener = getRuntimeListener<PromiseRejectionEvent>(
        harness,
        "unhandledrejection",
      );
      assertEquals(isFromStudio(studioHandshakeEvent(harness)), true);

      errorListener({
        message: "e".repeat(70_000),
        filename: "https://preview.example/source.ts?token=<TOKEN>#private",
        lineno: 12,
        colno: 4,
      } as ErrorEvent);
      rejectionListener({ reason: "r".repeat(70_000) } as PromiseRejectionEvent);
      _flushPendingForTest();

      assertEquals(hoverOverlay.style.display, "none");
      assertEquals(selectionOverlay.style.display, "none");
      assertEquals(harness.posted.length, 2);
      for (const call of harness.posted) {
        assertEquals(call.targetOrigin, "https://studio.veryfront.com");
        assertEquals(MessageFromRendererSchema.safeParse(call.message).success, true);
      }

      const runtimeError = harness.posted[0]!.message as {
        action: string;
        url: string;
        errors: Array<{ message: string; file?: string; line?: number; column?: number }>;
      };
      assertEquals(runtimeError.action, "runtimeError");
      assertEquals(runtimeError.url, "https://preview.example/page");
      assertEquals(runtimeError.errors[0]!.message.length <= 65_536, true);
      assertEquals(runtimeError.errors[0]!.file, "https://preview.example/source.ts");
      assertEquals(runtimeError.errors[0]!.line, 12);
      assertEquals(runtimeError.errors[0]!.column, 4);

      const rejection = harness.posted[1]!.message as {
        action: string;
        url: string;
        errors: Array<{ message: string }>;
      };
      assertEquals(rejection.action, "runtimeError");
      assertEquals(rejection.url, "https://preview.example/page");
      assertEquals(rejection.errors[0]!.message.length <= 65_536, true);
    } finally {
      disposeErrorHandling();
      _resetForTest();
      state.hoverOverlay = originalHoverOverlay;
      state.selectionOverlay = originalSelectionOverlay;
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        configurable: true,
      });
    }
  });

  it("makes captured runtime callbacks inert after disposal", () => {
    const originalWindow = globalThis.window;
    const originalHoverOverlay = state.hoverOverlay;
    const originalSelectionOverlay = state.selectionOverlay;
    const harness = createRuntimeWindowHarness();
    const hoverOverlay = { style: { display: "block" } } as unknown as HTMLElement;
    const selectionOverlay = { style: { display: "block" } } as unknown as HTMLElement;
    Object.defineProperty(globalThis, "window", {
      value: harness.window,
      configurable: true,
    });
    state.hoverOverlay = hoverOverlay;
    state.selectionOverlay = selectionOverlay;

    try {
      _resetForTest();
      setupErrorHandling();
      const errorListener = getRuntimeListener<ErrorEvent>(harness, "error");
      const rejectionListener = getRuntimeListener<PromiseRejectionEvent>(
        harness,
        "unhandledrejection",
      );
      disposeErrorHandling();

      assertEquals(harness.listeners.get("error")?.size, 0);
      assertEquals(harness.listeners.get("unhandledrejection")?.size, 0);
      errorListener({ message: "late error" } as ErrorEvent);
      rejectionListener({ reason: "late rejection" } as PromiseRejectionEvent);

      assertEquals(hoverOverlay.style.display, "block");
      assertEquals(selectionOverlay.style.display, "block");
      assertEquals(_pendingCountForTest(), 0);
      assertEquals(harness.posted.length, 0);
    } finally {
      disposeErrorHandling();
      _resetForTest();
      state.hoverOverlay = originalHoverOverlay;
      state.selectionOverlay = originalSelectionOverlay;
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        configurable: true,
      });
    }
  });

  it("installs and disposes error listeners idempotently", () => {
    const originalWindow = globalThis.window;
    const listeners = new Map<string, Set<EventListener>>();
    const fakeWindow = {
      addEventListener(type: string, listener: EventListener) {
        const registered = listeners.get(type) ?? new Set<EventListener>();
        registered.add(listener);
        listeners.set(type, registered);
      },
      removeEventListener(type: string, listener: EventListener) {
        listeners.get(type)?.delete(listener);
      },
    };
    Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
    try {
      setupErrorHandling();
      setupErrorHandling();
      assertEquals(listeners.get("error")?.size, 1);
      assertEquals(listeners.get("unhandledrejection")?.size, 1);

      disposeErrorHandling();
      assertEquals(listeners.get("error")?.size, 0);
      assertEquals(listeners.get("unhandledrejection")?.size, 0);
    } finally {
      disposeErrorHandling();
      Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
    }
  });
});
