import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentContext, AgentMiddleware, AgentResponse } from "../types.ts";
import { createMiddlewareChain } from "./chain.ts";

const context: AgentContext = {
  agentId: "agent",
  input: "hello",
  platform: {},
};

function response(text: string): AgentResponse {
  return { text, messages: [], toolCalls: [], status: "completed" };
}

describe("MiddlewareChain", () => {
  it("snapshots the initial middleware list", async () => {
    const calls: string[] = [];
    const initial: AgentMiddleware[] = [async (_context, next) => {
      calls.push("initial");
      return await next();
    }];
    const chain = createMiddlewareChain(initial);

    initial.push(async (_context, next) => {
      calls.push("mutated");
      return await next();
    });

    await chain.execute(context, () => Promise.resolve(response("ok")));

    assertEquals(calls, ["initial"]);
  });

  it("rejects middleware that invokes next more than once", async () => {
    let finalHandlerCalls = 0;
    const chain = createMiddlewareChain([
      async (_context, next) => {
        await next();
        return await next();
      },
    ]);

    await assertRejects(
      () =>
        chain.execute(context, () => {
          finalHandlerCalls++;
          return Promise.resolve(response("ok"));
        }),
      Error,
      "next() called multiple times",
    );
    assertEquals(finalHandlerCalls, 1);
  });
});
