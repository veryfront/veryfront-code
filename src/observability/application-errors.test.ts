import { assertEquals } from "@std/assert";
import {
  captureApplicationError,
  flushApplicationErrors,
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
