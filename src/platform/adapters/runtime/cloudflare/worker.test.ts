import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MiddlewarePipeline } from "#veryfront/middleware/core/pipeline/index.ts";
import { createWorker } from "./worker.ts";
import type { ExecutionContext } from "./worker.ts";

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
  };
}

describe("createWorker", () => {
  it("resolves a pipeline from the current request bindings", async () => {
    let setupCalls = 0;
    let executeCalls = 0;
    const worker = createWorker((env: { MODE: string }) => {
      setupCalls++;
      return new MiddlewarePipeline().use((context) => {
        executeCalls++;
        return new Response(`${env.MODE}:${String(context.env.MODE)}`);
      });
    });
    const context = createExecutionContext();

    const firstResult: Promise<Response> = worker.fetch(
      new Request("https://example.com/first"),
      { MODE: "old" },
      context,
    );
    const first = await firstResult;
    const second = await worker.fetch(
      new Request("https://example.com/second"),
      { MODE: "rotated" },
      context,
    );

    assertEquals(await first.text(), "old:old");
    assertEquals(await second.text(), "rotated:rotated");
    assertEquals(setupCalls, 2);
    assertEquals(executeCalls, 2);
  });

  it("supports an explicitly shared pipeline without capturing bindings", async () => {
    let requestCount = 0;
    const pipeline = new MiddlewarePipeline().use((context) => {
      requestCount++;
      return new Response(`${requestCount}:${String(context.env.MODE)}`);
    });
    const worker = createWorker<{ MODE: string }>(pipeline);
    const context = createExecutionContext();

    const first = await worker.fetch(
      new Request("https://example.com/first"),
      { MODE: "old" },
      context,
    );
    const second = await worker.fetch(
      new Request("https://example.com/second"),
      { MODE: "rotated" },
      context,
    );

    assertEquals(await first.text(), "1:old");
    assertEquals(await second.text(), "2:rotated");
  });

  it("passes the exact request, environment, and execution context", async () => {
    const request = new Request("https://example.com/context");
    const env = { TOKEN: "placeholder" };
    const executionContext = createExecutionContext();
    let capturedRequest: Request | undefined;
    let capturedEnv: Record<string, unknown> | undefined;
    let capturedExecutionContext: ExecutionContext | undefined;
    const pipeline = new MiddlewarePipeline();
    const originalExecute = pipeline.execute.bind(pipeline);
    pipeline.execute = (receivedRequest, receivedEnv, receivedContext, adapter) => {
      capturedRequest = receivedRequest;
      capturedEnv = receivedEnv;
      capturedExecutionContext = receivedContext;
      return originalExecute(receivedRequest, receivedEnv, receivedContext, adapter);
    };
    pipeline.use(() => new Response("ok"));
    const worker = createWorker(() => pipeline);

    await worker.fetch(request, env, executionContext);

    assertEquals(capturedRequest, request);
    assertEquals(capturedEnv, env);
    assertEquals(capturedExecutionContext, executionContext);
  });

  it("retries lazy setup after a synchronous setup failure", async () => {
    let setupCalls = 0;
    const worker = createWorker(() => {
      setupCalls++;
      if (setupCalls === 1) throw new Error("setup failed");
      return new MiddlewarePipeline().use(() => new Response("recovered"));
    });
    const request = new Request("https://example.com/retry");
    const context = createExecutionContext();

    await assertRejects(() => worker.fetch(request, {}, context), Error, "setup failed");
    const response = await worker.fetch(request, {}, context);

    assertEquals(await response.text(), "recovered");
    assertEquals(setupCalls, 2);
  });
});
