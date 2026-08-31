import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

import type { AgentContext, AgentResponse } from "../types.ts";
import { MiddlewareChain } from "./chain.ts";

const context = {} as AgentContext;
const response = {} as AgentResponse;
const replayError = "next() can only be called once while middleware is active";

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
    await assertRejects(() => retainedNext!(), Error, replayError);
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
    await assertRejects(() => retainedNext!(), Error, replayError);
    assertEquals(finalHandlerCalls, 0);
  });

  it("rejects concurrent continuation replay", async () => {
    let releaseFinalHandler: (() => void) | undefined;
    const finalHandlerStarted = Promise.withResolvers<void>();
    const chain = new MiddlewareChain([
      async (_context, next) => {
        const first = next();
        await finalHandlerStarted.promise;
        await assertRejects(() => next(), Error, replayError);
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
});
