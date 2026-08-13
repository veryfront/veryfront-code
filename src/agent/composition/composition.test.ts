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

import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Agent, AgentResponse, AgentStreamResult } from "../types.ts";

// Side-effect import: registers the globalThis bridges
import { agentAsTool, agentRegistry, registerAgent } from "./composition.ts";
import { createInvokeAgentTool } from "../runtime/agent-delegation.ts";
import { parseInvokeAgentStreamValue } from "#veryfront/chat/invoke-agent-stream.ts";

const BRIDGE_KEYS = ["__vfGetAgent", "__vfRegisterAgent", "__vfGetAllAgentIds"] as const;

describe("globalThis agent registry bridges", () => {
  it("should tolerate repeated module evaluation", async () => {
    await import("./composition.ts?duplicate-agent-bridge-test");
  });

  it("should delegate duplicate module registry reads to the existing bridge", async () => {
    const id = "duplicate-bridge-agent";
    const agent = createMinimalAgent(id);

    registerAgent(id, agent);
    try {
      const duplicate = await import("./composition.ts?duplicate-agent-bridge-delegation-test");

      assertEquals(duplicate.getAgent(id), agent);
      assertEquals(duplicate.getAllAgentIds().includes(id), true);
    } finally {
      agentRegistry.delete(id);
    }
  });

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

function createMinimalAgent(id: string): Agent {
  const response: AgentResponse = {
    text: "ok",
    messages: [],
    toolCalls: [],
    status: "completed",
  };

  return {
    id,
    config: {
      model: "anthropic/claude-sonnet-4-6",
      system: "Test agent",
    },
    generate: () => Promise.resolve(response),
    async stream(input): Promise<AgentStreamResult> {
      input.onFinish?.(response);
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
}

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

  it("preserves the child stream error when no final response is produced", async () => {
    const childAgent = createMinimalAgent("failing-child");
    childAgent.stream = () =>
      Promise.resolve({
        toDataStreamResponse() {
          return new Response(
            'data: {"type":"error","error":"Veryfront API MCP is unavailable"}\n\n',
            { headers: { "Content-Type": "text/event-stream" } },
          );
        },
      });

    const tool = agentAsTool(childAgent, "Run failing child agent");

    await assertRejects(
      () => tool.execute({ input: "Process the inbox" }),
      Error,
      "Veryfront API MCP is unavailable",
    );
  });

  it("publishes child stream events against the parent invoke_agent tool call", async () => {
    const childResponse: AgentResponse = {
      text: "streamed child result",
      messages: [],
      toolCalls: [],
      status: "completed",
    };
    const childAgent = createMinimalAgent("case-ingest");
    childAgent.stream = (input) => {
      input.onFinish?.(childResponse);
      return Promise.resolve({
        toDataStreamResponse() {
          return new Response(
            [
              'data: {"type":"message-start","messageId":"child-message"}',
              'data: {"type":"text-delta","id":"child-text","delta":"Fetching cases"}',
              "",
            ].join("\n\n"),
            { headers: { "Content-Type": "text/event-stream" } },
          );
        },
      });
    };
    const events: unknown[] = [];
    const tool = createInvokeAgentTool({ resolveAgent: () => childAgent });

    await tool.execute(
      {
        agent_id: "case-ingest",
        description: "Run case ingest",
        prompt: "Fetch cases",
        context: {},
      },
      {
        toolCallId: "parent-tool-call",
        publishDataEvent: (event) => {
          events.push(event);
        },
      },
    );

    assertEquals(events, [
      {
        type: "veryfront.invoke_agent.stream",
        name: "veryfront.invoke_agent.stream",
        value: {
          toolCallId: "parent-tool-call",
          agentId: "case-ingest",
          event: { type: "message-start", messageId: "child-message" },
        },
      },
      {
        type: "veryfront.invoke_agent.stream",
        name: "veryfront.invoke_agent.stream",
        value: {
          toolCallId: "parent-tool-call",
          agentId: "case-ingest",
          event: { type: "text-delta", id: "child-text", delta: "Fetching cases" },
        },
      },
    ]);
  });

  it("attaches the child agent's name and avatar to every published event", async () => {
    const childResponse: AgentResponse = {
      text: "streamed child result",
      messages: [],
      toolCalls: [],
      status: "completed",
    };
    const childAgent = createMinimalAgent("case-ingest");
    childAgent.config.name = "Intake Bot";
    childAgent.config.avatarUrl = "https://cdn.example.com/agents/case-ingest.png";
    childAgent.stream = (input) => {
      input.onFinish?.(childResponse);
      return Promise.resolve({
        toDataStreamResponse() {
          return new Response(
            [
              'data: {"type":"message-start","messageId":"child-message"}',
              'data: {"type":"text-delta","id":"child-text","delta":"Fetching cases"}',
              "",
            ].join("\n\n"),
            { headers: { "Content-Type": "text/event-stream" } },
          );
        },
      });
    };
    const published: unknown[] = [];
    const tool = createInvokeAgentTool({ resolveAgent: () => childAgent });

    await tool.execute(
      { agent_id: "case-ingest", description: "Run case ingest", prompt: "Fetch", context: {} },
      {
        toolCallId: "parent-tool-call",
        publishDataEvent: (event) => {
          published.push(event.value);
        },
      },
    );

    // The card header must show the child's identity while it runs, so the
    // identity rides along with the first event, not just the last.
    assertEquals(published.length, 2);
    for (const value of published) {
      const parsed = parseInvokeAgentStreamValue(value);
      assertEquals(parsed?.agentName, "Intake Bot");
      assertEquals(parsed?.avatarUrl, "https://cdn.example.com/agents/case-ingest.png");
    }
  });

  it("falls back to the deprecated snake_case avatar field", async () => {
    const childAgent = createMinimalAgent("case-ingest");
    childAgent.config.avatar_url = "https://cdn.example.com/legacy.png";
    childAgent.stream = (input) => {
      input.onFinish?.({ text: "ok", messages: [], toolCalls: [], status: "completed" });
      return Promise.resolve({
        toDataStreamResponse() {
          return new Response('data: {"type":"message-start","messageId":"child-message"}\n\n', {
            headers: { "Content-Type": "text/event-stream" },
          });
        },
      });
    };
    const published: unknown[] = [];
    const tool = createInvokeAgentTool({ resolveAgent: () => childAgent });

    await tool.execute(
      { agent_id: "case-ingest", description: "Run case ingest", prompt: "Fetch", context: {} },
      {
        toolCallId: "parent-tool-call",
        publishDataEvent: (event) => {
          published.push(event.value);
        },
      },
    );

    assertEquals(
      parseInvokeAgentStreamValue(published.at(0))?.avatarUrl,
      "https://cdn.example.com/legacy.png",
    );
  });

  it("does not publish child events for fixed agent wrappers", async () => {
    const childAgent = createMinimalAgent("case-ingest");
    const events: unknown[] = [];
    await agentAsTool(childAgent, "Run case ingest").execute(
      { input: "Fetch cases" },
      {
        toolCallId: "fixed-agent-tool-call",
        publishDataEvent: (event) => {
          events.push(event);
        },
      },
    );
    assertEquals(events, []);
  });

  it("publishes child content while the child tool execution is still running", async () => {
    let childController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let finishChild: (() => void) | undefined;
    let resolvePublished: (() => void) | undefined;
    const published = new Promise<void>((resolve) => {
      resolvePublished = resolve;
    });
    const childAgent = createMinimalAgent("case-ingest");
    childAgent.stream = (input) => {
      finishChild = () => {
        input.onFinish?.({ text: "done", messages: [], toolCalls: [], status: "completed" });
      };
      return Promise.resolve({
        toDataStreamResponse() {
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                childController = controller;
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          );
        },
      });
    };
    const tool = agentAsTool(childAgent, "Run case ingest", { publishChildStream: true });
    let settled = false;
    const execution = tool.execute(
      { input: "Fetch cases" },
      {
        toolCallId: "parent-tool-call",
        publishDataEvent: () => {
          resolvePublished?.();
        },
      },
    ).then(() => {
      settled = true;
    });

    await Promise.resolve();
    childController?.enqueue(
      new TextEncoder().encode(
        'data: {"type":"text-delta","id":"child-text","delta":"Fetching cases"}\n\n',
      ),
    );
    await published;

    assertEquals(settled, false);
    finishChild?.();
    childController?.close();
    await execution;
  });
});
