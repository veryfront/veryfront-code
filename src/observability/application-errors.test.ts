import { assertEquals } from "@std/assert";
import {
  type ApplicationErrorContext,
  captureApplicationError,
  flushApplicationErrors,
  setApplicationErrorReporter,
} from "./application-errors.ts";
import type { ApplicationErrorContext as SharedApplicationErrorContext } from "./application-error-contract.ts";

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

Deno.test("application error context is exported from the shared contract with severity level", () => {
  const context: ApplicationErrorContext = {
    boundary: "renderer.request",
    level: "warning",
    processRole: "api",
  };
  const sharedContext: SharedApplicationErrorContext = context;

  assertEquals(sharedContext.level, "warning");
  assertEquals(sharedContext.processRole, "api");
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
