import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  type ApplicationErrorContext,
  captureApplicationError,
  flushApplicationErrors,
  setApplicationErrorReporter,
} from "./application-errors.ts";
import type { ApplicationErrorContext as SharedApplicationErrorContext } from "./application-error-contract.ts";

it("application error reporter is optional", async () => {
  setApplicationErrorReporter(undefined);

  assertEquals(
    captureApplicationError(new Error("not reported"), { boundary: "test" }),
    undefined,
  );
  assertEquals(await flushApplicationErrors(), true);
});

it("application error reporter receives unexpected failures and correlation context", async () => {
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

it("application error context exports process role from the shared contract", () => {
  const context: ApplicationErrorContext = {
    boundary: "renderer.request",
    processRole: "api",
  };
  const sharedContext: SharedApplicationErrorContext = context;

  assertEquals(sharedContext.processRole, "api");
});

it("application error reporter ignores expected cancellation", () => {
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
