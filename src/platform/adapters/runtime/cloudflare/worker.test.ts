import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MiddlewarePipeline } from "#veryfront/middleware/core/pipeline/index.ts";
import { createWorker, type ExecutionContext } from "./worker.ts";

describe("createWorker", () => {
  it("returns a typed module-worker fetch handler and forwards runtime context", async () => {
    const env = { GREETING: "hello" };
    const context: ExecutionContext = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    };
    let setupEnv: unknown;
    let observedEnv: unknown;
    let observedContext: unknown;
    const worker = createWorker((bindings) => {
      setupEnv = bindings;
      return new MiddlewarePipeline().use((ctx) => {
        observedEnv = ctx.env;
        observedContext = ctx.executionCtx;
        return new Response(bindings.GREETING as string);
      });
    });

    const response: Response = await worker.fetch(
      new Request("https://example.com"),
      env,
      context,
    );

    assertEquals(await response.text(), "hello");
    assertEquals(setupEnv, env);
    assertEquals(observedEnv, env);
    assertEquals(observedContext, context);
  });
});
