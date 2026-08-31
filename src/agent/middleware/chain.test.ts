import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentContext, AgentResponse } from "../types.ts";
import { MiddlewareChain } from "./chain.ts";

const context = {} as AgentContext;
const response = {} as AgentResponse;

describe("agent/middleware/chain", () => {
  it("allows each middleware continuation to run only once", async () => {
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
    await assertRejects(
      () => retainedNext!(),
      Error,
      "next() called multiple times",
    );
    assertEquals(finalHandlerCalls, 1);
  });

  it("rejects concurrent continuation replay", async () => {
    let releaseFinalHandler: (() => void) | undefined;
    const finalHandlerStarted = Promise.withResolvers<void>();
    const chain = new MiddlewareChain([
      async (_context, next) => {
        const first = next();
        await finalHandlerStarted.promise;
        await assertRejects(() => next(), Error, "next() called multiple times");
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
});
