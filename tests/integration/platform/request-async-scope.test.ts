import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  getActiveRunEventSinks,
  runWithMandatoryRunEventSink,
  runWithRunEventSink,
} from "#veryfront/runtime/run-event-sink-context.ts";
import type { AgentRunEventSink } from "#veryfront/runtime/model-call-context.ts";
import {
  bindRuntimeObservationWriterCapability,
  createRuntimeObservationWriterCapability,
  getRuntimeObservationWriterBinding,
  revokeRuntimeObservationWriterCapability,
} from "#veryfront/runtime/runtime-observation-carrier.ts";
import { scopeRequestAsyncContext } from "#veryfront/platform/compat/http/request-async-scope.ts";

describe("native request async-context isolation", () => {
  it("discards an expired writer despite replacement of the async-resource prototype", () => {
    const loggerContext = new AsyncLocalStorage<string>();
    const staleSink: AgentRunEventSink = () => {};
    const capability = createRuntimeObservationWriterCapability({
      scope: { runId: "old", canonicalRunId: crypto.randomUUID(), projectId: crypto.randomUUID() },
    });
    bindRuntimeObservationWriterCapability(staleSink, capability);
    revokeRuntimeObservationWriterCapability(capability);
    const handler = scopeRequestAsyncContext(() => {
      const sinks = getActiveRunEventSinks();
      getRuntimeObservationWriterBinding(sinks.mandatory)?.assertActive();
      assertEquals(sinks, { mandatory: undefined, public: undefined });
      assertEquals(loggerContext.getStore(), undefined);
      return "ok";
    });
    const original = AsyncResource.prototype.runInAsyncScope;
    try {
      AsyncResource.prototype.runInAsyncScope = function (callback, thisArg, ...args) {
        return Reflect.apply(callback, thisArg, args);
      };
      const result = loggerContext.run(
        "old",
        () =>
          runWithMandatoryRunEventSink(staleSink, () => handler(new Request("http://localhost/"))),
      );
      assertEquals(result, "ok");
    } finally {
      AsyncResource.prototype.runInAsyncScope = original;
    }
  });
  it("discards context retained by an earlier dynamic import", async () => {
    const loggerContext = new AsyncLocalStorage<string>();
    const bootstrapSink: AgentRunEventSink = () => {};
    const requestSink: AgentRunEventSink = () => {};
    await loggerContext.run(
      "earlier-request",
      () =>
        runWithMandatoryRunEventSink(
          bootstrapSink,
          () =>
            runWithRunEventSink(bootstrapSink, () =>
              import(
                `data:text/javascript,export const nonce=${JSON.stringify(crypto.randomUUID())}`
              )),
        ),
    );
    assertEquals(loggerContext.getStore(), undefined);
    assertEquals(getActiveRunEventSinks(), { mandatory: undefined, public: undefined });

    const seen: unknown[] = [];
    const server = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen: () => {} },
      scopeRequestAsyncContext(() => {
        seen.push({ logger: loggerContext.getStore(), ...getActiveRunEventSinks() });
        return runWithMandatoryRunEventSink(requestSink, async () => {
          await Promise.resolve();
          assertEquals(getActiveRunEventSinks().mandatory, requestSink);
          const body = new ReadableStream<Uint8Array>({
            async start(controller) {
              await new Promise((resolve) => setTimeout(resolve, 0));
              assertEquals(getActiveRunEventSinks().mandatory, requestSink);
              controller.enqueue(new TextEncoder().encode("ok"));
              controller.close();
            },
          });
          return new Response(body);
        });
      }),
    );
    try {
      for (let index = 0; index < 2; index++) {
        const response = await fetch(`http://127.0.0.1:${server.addr.port}/`);
        assertEquals(await response.text(), "ok");
      }
      assertEquals(seen, [
        { logger: undefined, mandatory: undefined, public: undefined },
        { logger: undefined, mandatory: undefined, public: undefined },
      ]);
    } finally {
      await server.shutdown();
    }
  });
});
