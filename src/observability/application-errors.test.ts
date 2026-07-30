import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "@std/assert";
import {
  captureApplicationError,
  flushApplicationErrors,
  initializeApplicationErrorReporter,
  setApplicationErrorReporter,
} from "./application-errors.ts";

Deno.test("application error reporter is optional", async () => {
  setApplicationErrorReporter(undefined);

  assertEquals(
    captureApplicationError(new Error("not reported"), { boundary: "test" }),
    undefined,
  );
  assertEquals(await flushApplicationErrors(), true);
});

Deno.test("application error reporter receives unexpected failures and correlation context", async () => {
  const captures: Array<{ error: unknown; boundary: string; traceId?: string }> = [];
  let flushTimeout: number | undefined;
  setApplicationErrorReporter({
    capture(error, context) {
      captures.push({ error, boundary: context.boundary, traceId: context.traceId });
      return "event-id";
    },
    flush(timeoutMs) {
      flushTimeout = timeoutMs;
      return Promise.resolve(true);
    },
  });

  const error = new Error("render failed");
  assertEquals(
    captureApplicationError(error, {
      boundary: "renderer.request",
      traceId: "trace-1",
    }),
    "event-id",
  );
  assertEquals(captures, [{ error, boundary: "renderer.request", traceId: "trace-1" }]);
  assertEquals(await flushApplicationErrors(1_500), true);
  assertEquals(flushTimeout, 1_500);
});

Deno.test("application error reporter ignores expected cancellation", () => {
  let captured = false;
  setApplicationErrorReporter({
    capture() {
      captured = true;
      return "event-id";
    },
    flush: () => Promise.resolve(true),
  });

  const eventId = captureApplicationError(
    new DOMException("request cancelled", "AbortError"),
    { boundary: "renderer.request" },
  );

  assertEquals(eventId, undefined);
  assertEquals(captured, false);
});

Deno.test("application error capture failures never replace application control flow", () => {
  const hostile = new Proxy({}, {
    getPrototypeOf() {
      throw new Error("prototype unavailable");
    },
  });
  setApplicationErrorReporter({
    capture() {
      throw new Error("reporter unavailable");
    },
    flush: () => Promise.resolve(true),
  });

  assertEquals(
    captureApplicationError(hostile, { boundary: "renderer.request" }),
    undefined,
  );
});

Deno.test("application error flush is strictly bounded and fail-open", async () => {
  setApplicationErrorReporter({
    capture: () => undefined,
    flush: () => new Promise<boolean>(() => {}),
  });

  assertEquals(await flushApplicationErrors(5), false);

  setApplicationErrorReporter({
    capture: () => undefined,
    flush: () => Promise.reject(new Error("transport unavailable")),
  });
  assertEquals(await flushApplicationErrors(5), false);
  assertEquals(await flushApplicationErrors(-1), false);
});

Deno.test("application error initialization is explicitly disabled without a selected initializer", async () => {
  const lifecycle = await initializeApplicationErrorReporter({
    serviceName: "test-service",
  });

  assertEquals(lifecycle.enabled, false);
  assertEquals(await lifecycle.flush(), true);
  await lifecycle.dispose();
});

Deno.test("selected application error initializer failures propagate unchanged", async () => {
  const initializationError = new Error("reporter initialization failed");
  const thrown = await assertRejects(() =>
    initializeApplicationErrorReporter({
      initializer: {
        initialize: () => Promise.reject(initializationError),
      },
      serviceName: "test-service",
    })
  );

  assertStrictEquals(thrown, initializationError);
});

Deno.test("application error initialization rejects invalid service identities and direct replacement races", async () => {
  await assertRejects(
    () =>
      initializeApplicationErrorReporter({
        serviceName: " invalid ",
      }),
    TypeError,
    "canonical string",
  );

  let resolveInitialization: ((value: undefined) => void) | undefined;
  let markInitializationStarted: (() => void) | undefined;
  const initializationStarted = new Promise<void>((resolve) => {
    markInitializationStarted = resolve;
  });
  const pending = initializeApplicationErrorReporter({
    initializer: {
      initialize: () =>
        new Promise<undefined>((resolve) => {
          resolveInitialization = resolve;
          markInitializationStarted?.();
        }),
    },
    serviceName: "test-service",
  });
  assertThrows(
    () => setApplicationErrorReporter(undefined),
    Error,
    "Wait for application-error initialization",
  );
  await initializationStarted;
  resolveInitialization?.(undefined);
  await pending;
});

Deno.test("application error lifecycle publishes, flushes, and disposes one owned reporter", async () => {
  const captures: unknown[] = [];
  const flushTimeouts: Array<number | undefined> = [];
  let disposeCalls = 0;
  const lifecycle = await initializeApplicationErrorReporter({
    initializer: {
      initialize: ({ serviceName }) => {
        assertEquals(serviceName, "test-service");
        return {
          reporter: {
            capture(error) {
              captures.push(error);
              return "event-id";
            },
            flush(timeoutMs) {
              flushTimeouts.push(timeoutMs);
              return Promise.resolve(true);
            },
          },
          dispose() {
            disposeCalls++;
          },
        };
      },
    },
    serviceName: "test-service",
  });

  const error = new Error("reported");
  assertEquals(lifecycle.capture(error, { boundary: "test" }), "event-id");
  assertEquals(await lifecycle.flush(50), true);
  await lifecycle.dispose();
  await lifecycle.dispose();

  assertEquals(captures, [error]);
  assertEquals(flushTimeouts, [50]);
  assertEquals(disposeCalls, 1);
  assertEquals(lifecycle.capture(new Error("stale"), { boundary: "test" }), undefined);
});

Deno.test("superseded application error initialization disposes stale state before starting its replacement", async () => {
  let resolveFirst:
    | ((value: {
      reporter: { capture(): string; flush(): Promise<boolean> };
      dispose(): void;
    }) => void)
    | undefined;
  let markFirstStarted: (() => void) | undefined;
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  let finishStaleDisposal: (() => void) | undefined;
  const staleDisposalFinished = new Promise<void>((resolve) => {
    finishStaleDisposal = resolve;
  });
  let markStaleDisposalStarted: (() => void) | undefined;
  const staleDisposalStarted = new Promise<void>((resolve) => {
    markStaleDisposalStarted = resolve;
  });
  let staleDisposeCalls = 0;
  let secondInitializeCalls = 0;
  const first = initializeApplicationErrorReporter({
    initializer: {
      initialize: () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
          markFirstStarted?.();
        }),
    },
    serviceName: "first",
  });
  await firstStarted;

  const secondPending = initializeApplicationErrorReporter({
    initializer: {
      initialize: () => {
        secondInitializeCalls++;
        return {
          reporter: {
            capture: () => "second",
            flush: () => Promise.resolve(true),
          },
          dispose: () => {},
        };
      },
    },
    serviceName: "second",
  });
  resolveFirst?.({
    reporter: {
      capture: () => "first",
      flush: () => Promise.resolve(true),
    },
    async dispose() {
      staleDisposeCalls++;
      markStaleDisposalStarted?.();
      await staleDisposalFinished;
    },
  });

  await staleDisposalStarted;
  assertEquals(secondInitializeCalls, 0);
  finishStaleDisposal?.();
  const firstLifecycle = await first;
  const second = await secondPending;
  assertEquals(firstLifecycle.enabled, false);
  assertEquals(staleDisposeCalls, 1);
  assertEquals(secondInitializeCalls, 1);
  assertEquals(second.capture(new Error("current"), { boundary: "test" }), "second");
  await second.dispose();
});
