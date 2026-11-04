import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { ModelRuntime, ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import { tool } from "#veryfront/tool";
import { agent } from "#veryfront/agent/factory.ts";
import {
  readStructuredAgentOutput,
  structuredAgentOutputForWire,
} from "#veryfront/agent/output-schema.ts";
import {
  readInheritedLocalChildResult,
  runInheritedLocalAgent,
  terminalAgentOutput,
} from "#veryfront/agent/composition/inherited-local-agent.ts";
import { securityMiddleware } from "#veryfront/agent/middleware/security/validator.ts";

const noopTool = tool({
  id: "snapshot_noop_tool",
  description: "Succeeds without side effects",
  inputSchema: defineSchema((v) => v.object({}))(),
  execute: () => ({ ok: true }),
});

/** Answers with text plus a tool call, so the run exits through the max-steps path. */
function createMaxStepsModel(text: string): ModelRuntime<ModelRuntimeCallOptions> {
  let call = 0;
  return {
    provider: "test",
    modelId: "test/max-steps",
    executionMode: "remote",
    runtimeCapabilities: { structuredOutput: true },
    doGenerate() {
      call++;
      return Promise.resolve({
        content: [
          { type: "text", text },
          {
            type: "tool-call",
            toolCallId: `call-${call}`,
            toolName: "snapshot_noop_tool",
            input: "{}",
          },
        ],
        finishReason: "tool-calls" as const,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      });
    },
    doStream() {
      call++;
      const parts: unknown[] = [
        { type: "text-delta", text },
        {
          type: "tool-call",
          toolCallId: `call-${call}`,
          toolName: "snapshot_noop_tool",
          input: {},
        },
        {
          type: "finish",
          finishReason: "tool-calls",
          totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        },
      ];
      return Promise.resolve({
        stream: new ReadableStream<unknown>({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      });
    },
  };
}

describe("structured output snapshot intrinsics", () => {
  it("marks non-finite output even after a transform replaces Number.isFinite", async () => {
    const originalIsFinite = Number.isFinite;
    const tamperingSchema = defineSchema((v) =>
      v.object({ city: v.string() }).transform(() => {
        Number.isFinite = () => true;
        return Number.POSITIVE_INFINITY;
      })
    );
    try {
      const assistant = agent({
        id: "stream-output-snapshot-tampered-is-finite",
        system: "You report weather.",
        tools: { snapshot_noop_tool: noopTool },
        maxSteps: 1,
        outputSchema: tamperingSchema(),
        resolveModelTransport: () =>
          Promise.resolve({ model: createMaxStepsModel('{"city":"Berlin"}') }),
      });
      const result = await assistant.stream({ input: "Berlin?" });
      const body = await result.toDataStreamResponse().text();
      const finish = body.split("\n")
        .filter((line) => line.startsWith("data: {"))
        .map((line) => JSON.parse(line.slice(6)))
        .find((event) => event.type === "message-finish");
      assertEquals(finish?.data, {
        captureStatus: "unsupported",
        reasons: ["unsupported_number"],
        value: "[unsupported number]",
      });
      assertEquals(Object.hasOwn(finish, "object"), false);
    } finally {
      Number.isFinite = originalIsFinite;
    }
  });
});

// These regressions intentionally mutate host intrinsics and belong at the integration boundary.
describe("structured output reflection boundary", () => {
  it("preserves inherited child output after project code replaces reflection", async () => {
    const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    const ownKeys = Reflect.ownKeys;
    const isArray = Array.isArray;
    const some = Array.prototype.some;
    const data = { selected_count: 1 };
    const live = {
      text: JSON.stringify(data),
      data,
      object: data,
      messages: [{ role: "assistant", content: "private" }],
      toolCalls: [{ toolCallId: "call-1" }],
      status: "completed",
    };
    const stored = { text: JSON.stringify(data), data };
    const targets = new WeakSet<object>([live, stored]);
    try {
      Object.getOwnPropertyDescriptor = (target, key) =>
        targets.has(target) ? undefined : getOwnPropertyDescriptor(target, key);
      Reflect.ownKeys = (target) => targets.has(target) ? [] : ownKeys(target);
      Array.isArray = (value: unknown): value is unknown[] =>
        value === stored || (value !== live.toolCalls && isArray(value));
      Array.prototype.some = function (predicate, thisArg) {
        if (this.length === 2 && this[0] === "text" && this[1] === "data") return true;
        return Reflect.apply(some, this, [predicate, thisArg]);
      };

      assertEquals(terminalAgentOutput(live), { selected_count: 1 });
      assertEquals(readInheritedLocalChildResult(live), {
        text: JSON.stringify(data),
        data,
        object: data,
        toolCalls: 1,
        status: "completed",
      });
      assertEquals(
        await runInheritedLocalAgent(
          {
            terminalReceipt: {
              status: "completed",
              output: stored,
              outputFormat: "text-data-v1",
            },
          },
          { projectId: "project", apiUrl: "https://api.example.test", fetch },
          () => {
            throw new Error("must not execute");
          },
        ),
        {
          success: true,
          output: {
            text: JSON.stringify(data),
            data,
            object: data,
            status: "completed",
          },
          executionTime: 0,
        },
      );
    } finally {
      Object.getOwnPropertyDescriptor = getOwnPropertyDescriptor;
      Reflect.ownKeys = ownKeys;
      Array.isArray = isArray;
      Array.prototype.some = some;
    }
  });

  it("retains alias validation and wire canonicalization after reflection replacement", () => {
    const descriptor = Object.getOwnPropertyDescriptor;
    const same = Object.is;
    const data = { contact: "private" };
    try {
      Object.getOwnPropertyDescriptor = () => undefined;
      Object.is = () => true;
      assertEquals(readStructuredAgentOutput({ data }), { data, object: data });
      assertThrows(() => readStructuredAgentOutput({ data: false, object: true }));
      assertEquals<unknown>(structuredAgentOutputForWire({ type: "finish", data, object: data }), {
        type: "finish",
        data,
      });
    } finally {
      Object.getOwnPropertyDescriptor = descriptor;
      Object.is = same;
    }
  });

  it("filters structured PII after project code replaces reflection", async () => {
    const descriptor = Object.getOwnPropertyDescriptor;
    const middleware = securityMiddleware({ output: { filterPII: true } });
    const data = { email: "john@example.com" };
    try {
      const result = await middleware({
        agentId: "reflection-test",
        input: "Return contact details.",
        model: "test",
        data: {},
        platform: {},
      }, () => {
        Object.getOwnPropertyDescriptor = (target, key) =>
          key === "data" || key === "object" ? undefined : descriptor(target, key);
        return Promise.resolve({
          text: "Contact details",
          messages: [],
          toolCalls: [],
          status: "completed",
          data,
          object: data,
        });
      });
      assertEquals(result.data, { email: "[EMAIL]" });
      assertEquals(result.object, { email: "[EMAIL]" });
    } finally {
      Object.getOwnPropertyDescriptor = descriptor;
    }
  });
});
