import "#veryfront/schemas/_test-setup.ts";
/**
 * Composition globalThis hardening tests
 *
 * Verifies that the globalThis bridge properties (__vfGetAgent,
 * __vfRegisterAgent, __vfGetAllAgentIds) are non-writable,
 * non-enumerable, and non-configurable.
 *
 * @module agent/composition/composition.test
 */

import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Agent, AgentResponse, AgentStreamResult } from "../types.ts";

// Side-effect import: registers the globalThis bridges
import { agentAsTool } from "./composition.ts";

const BRIDGE_KEYS = ["__vfGetAgent", "__vfRegisterAgent", "__vfGetAllAgentIds"] as const;

describe("globalThis agent registry bridges", () => {
  for (const key of BRIDGE_KEYS) {
    describe(key, () => {
      it("should be defined on globalThis", () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
        assertEquals(descriptor !== undefined, true, `${key} should exist on globalThis`);
        assertEquals(typeof descriptor!.value, "function", `${key} should be a function`);
      });

      it("should be non-writable", () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)!;
        assertEquals(descriptor.writable, false, `${key} should not be writable`);
      });

      it("should be non-enumerable", () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)!;
        assertEquals(descriptor.enumerable, false, `${key} should not be enumerable`);
      });

      it("should be non-configurable", () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)!;
        assertEquals(descriptor.configurable, false, `${key} should not be configurable`);
      });

      it("should throw on assignment in strict mode", () => {
        assertThrows(
          () => {
            "use strict";
            (globalThis as Record<string, unknown>)[key] = () => {};
          },
          TypeError,
        );
      });

      it("should not appear in Object.keys(globalThis)", () => {
        const keys = Object.keys(globalThis);
        assertEquals(keys.includes(key), false, `${key} should not be enumerable`);
      });

      it("should not be deletable", () => {
        assertThrows(
          () => {
            "use strict";
            delete (globalThis as Record<string, unknown>)[key];
          },
          TypeError,
        );
      });

      it("should not be reconfigurable", () => {
        assertThrows(
          () => {
            Object.defineProperty(globalThis, key, { value: () => {} });
          },
          TypeError,
        );
      });
    });
  }
});

describe("agentAsTool", () => {
  it("executes child agents through the streaming path", async () => {
    let generated = false;
    let streamedInput: string | undefined;

    const childResponse: AgentResponse = {
      text: "streamed child result",
      messages: [],
      toolCalls: [],
      status: "completed",
    };

    const childAgent: Agent = {
      id: "child",
      config: {
        model: "anthropic/claude-sonnet-4-6",
        system: "Child agent",
      },
      async generate() {
        generated = true;
        return childResponse;
      },
      async stream(input): Promise<AgentStreamResult> {
        streamedInput = input.input;
        input.onFinish?.(childResponse);
        return {
          toDataStreamResponse() {
            return new Response("data: {}\n\n", {
              headers: { "Content-Type": "text/event-stream" },
            });
          },
        };
      },
      respond: () => Promise.resolve(new Response(null)),
      getMemory() {
        throw new Error("not used");
      },
      getMemoryStats: () =>
        Promise.resolve({
          totalMessages: 0,
          estimatedTokens: 0,
          type: "test",
        }),
      clearMemory: () => Promise.resolve(),
    };

    const tool = agentAsTool(childAgent, "Review with child agent");
    const result = await tool.execute({ input: "Review article 30" });

    assertEquals(generated, false);
    assertEquals(streamedInput, "Review article 30");
    assertEquals(result, {
      text: "streamed child result",
      toolCalls: 0,
      status: "completed",
    });
  });
});
