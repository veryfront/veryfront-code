import { AsyncLocalStorage } from "node:async_hooks";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  getActiveRunEventSinks,
  runWithMandatoryRunEventSink,
  runWithRunEventSink,
} from "#veryfront/runtime/run-event-sink-context.ts";
import type { AgentRunEventSink } from "#veryfront/runtime/model-call-context.ts";
import { scopeRequestAsyncContext } from "./request-async-scope.ts";

Deno.test("native requests discard context retained by an earlier dynamic import", async () => {
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
