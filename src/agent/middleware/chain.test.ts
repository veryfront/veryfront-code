import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";

import type { AgentContext, AgentResponse } from "#veryfront/agent/types.ts";
import { MiddlewareChain } from "#veryfront/agent/middleware/chain.ts";

const context = {} as AgentContext;
const response = {} as AgentResponse;
const replayError = "Agent middleware next() can only be called once while middleware is active";

describe("agent/middleware/chain", () => {
  it("rejects replay after a continuation completes", async () => {
    let retainedNext: (() => Promise<AgentResponse>) | undefined;
    let finalHandlerCalls = 0;
    const chain = new MiddlewareChain([
      async (_context, next) => {
        retainedNext = next;
        return await next();
      },
    ]);

    assertEquals(
      await chain.execute(context, () => {
        finalHandlerCalls += 1;
        return Promise.resolve(response);
      }),
      response,
    );
    const error = await assertRejects(() => retainedNext!(), VeryfrontError, replayError);
    assertEquals((error as VeryfrontError).slug, "middleware-error");
    assertEquals(finalHandlerCalls, 1);
  });

  it("rejects a retained continuation after middleware short-circuits", async () => {
    let retainedNext: (() => Promise<AgentResponse>) | undefined;
    let finalHandlerCalls = 0;
    const chain = new MiddlewareChain([
      (_context, next) => {
        retainedNext = next;
        return Promise.resolve(response);
      },
    ]);

    assertEquals(
      await chain.execute(context, () => {
        finalHandlerCalls += 1;
        return Promise.resolve(response);
      }),
      response,
    );
    await assertRejects(() => retainedNext!(), VeryfrontError, replayError);
    assertEquals(finalHandlerCalls, 0);
  });

  it("rejects concurrent continuation replay", async () => {
    let releaseFinalHandler: (() => void) | undefined;
    const finalHandlerStarted = Promise.withResolvers<void>();
    const chain = new MiddlewareChain([
      async (_context, next) => {
        const first = next();
        await finalHandlerStarted.promise;
        await assertRejects(() => next(), VeryfrontError, replayError);
        releaseFinalHandler?.();
        return await first;
      },
    ]);

    await chain.execute(context, () => {
      finalHandlerStarted.resolve();
      return new Promise<AgentResponse>((resolve) => {
        releaseFinalHandler = () => resolve(response);
      });
    });
  });

  it("preserves one awaited continuation per middleware", async () => {
    const calls: string[] = [];
    const chain = new MiddlewareChain([
      async (_context, next) => {
        calls.push("outer-before");
        const result = await next();
        calls.push("outer-after");
        return result;
      },
      async (_context, next) => {
        calls.push("inner-before");
        const result = await next();
        calls.push("inner-after");
        return result;
      },
    ]);

    assertEquals(
      await chain.execute(context, () => {
        calls.push("final");
        return Promise.resolve(response);
      }),
      response,
    );
    assertEquals(calls, [
      "outer-before",
      "inner-before",
      "final",
      "inner-after",
      "outer-after",
    ]);
  });

  it("rejects a continuation queued before an already-settled middleware promise", async () => {
    let queuedNext: Promise<AgentResponse> | undefined;
    let finalHandlerCalls = 0;
    const chain = new MiddlewareChain([
      (_context, next) => {
        queueMicrotask(() => {
          queuedNext = next();
        });
        return Promise.resolve(response);
      },
    ]);

    assertEquals(
      await chain.execute(context, () => {
        finalHandlerCalls += 1;
        return Promise.resolve(response);
      }),
      response,
    );
    await assertRejects(() => queuedNext!, VeryfrontError, replayError);
    assertEquals(finalHandlerCalls, 0);
  });

  it("revokes a retained continuation when middleware throws", async () => {
    let retainedNext: (() => Promise<AgentResponse>) | undefined;
    const chain = new MiddlewareChain([
      (_context, next) => {
        retainedNext = next;
        throw new Error("middleware failed");
      },
    ]);

    await assertRejects(
      () => chain.execute(context, () => Promise.resolve(response)),
      Error,
      "middleware failed",
    );
    await assertRejects(() => retainedNext!(), VeryfrontError, replayError);
  });

  it("propagates downstream rejection through an awaited continuation", async () => {
    let observedError: unknown;
    const downstreamError = new Error("downstream failed");
    const chain = new MiddlewareChain([
      async (_context, next) => {
        try {
          return await next();
        } catch (error) {
          observedError = error;
          throw error;
        }
      },
    ]);

    const error = await assertRejects(
      () => chain.execute(context, () => Promise.reject(downstreamError)),
      Error,
      "downstream failed",
    );
    assertEquals(error, downstreamError);
    assertEquals(observedError, downstreamError);
  });

  it("invokes the final handler for an empty middleware chain", async () => {
    let finalHandlerCalls = 0;
    assertEquals(
      await new MiddlewareChain().execute(context, () => {
        finalHandlerCalls += 1;
        return Promise.resolve(response);
      }),
      response,
    );
    assertEquals(finalHandlerCalls, 1);
  });

  it("revokes a retained continuation when middleware rejects", async () => {
    let retainedNext: (() => Promise<AgentResponse>) | undefined;
    const middlewareError = new Error("middleware rejected");
    const chain = new MiddlewareChain([
      (_context, next) => {
        retainedNext = next;
        return Promise.reject(middlewareError);
      },
    ]);

    await assertRejects(
      () => chain.execute(context, () => Promise.resolve(response)),
      Error,
      "middleware rejected",
    );
    await assertRejects(() => retainedNext!(), VeryfrontError, replayError);
  });
});
