import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas";
import { tool } from "#veryfront/tool";
import { agent } from "#veryfront/agent/factory.ts";
import type { AgentConfig } from "#veryfront/agent/types.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import type { RuntimeToolFilterConfig } from "#veryfront/agent/runtime/runtime-tool-config.ts";

const MESSAGE_ID = "assistant-message-1";

function invokeAgentTool(onExecute: (task: string) => void = () => {}) {
  return tool({
    id: "invoke_agent",
    description: "Invoke a child agent",
    inputSchema: defineSchema((v) => v.object({ task: v.string() }))(),
    execute: ({ task }) => {
      onExecute(task);
      return { result: task };
    },
  });
}

describe("provider replay private intrinsics", () => {
  it("collects generated delegation args through the captured array check", async () => {
    let completedBatch: unknown;
    const originalIsArray = Array.isArray;
    const model = scriptedModel([() => {
      Array.isArray = (value: unknown): value is unknown[] =>
        originalIsArray(value) ||
        (value !== null && typeof value === "object" && Object.hasOwn(value, "task"));
      return {
        toolCalls: [
          { id: "child-1", name: "invoke_agent", input: { task: "first" } },
          { id: "child-2", name: "invoke_agent", input: { task: "second" } },
        ],
      };
    }], {
      modelId: "anthropic/captured-array-check-replay-boundary",
      provider: "anthropic",
      only: "generate",
    });
    const config = {
      id: "captured-array-check-replay-boundary",
      model: "anthropic/captured-array-check-replay-boundary",
      system: "Delegate twice.",
      skills: false,
      tools: { invoke_agent: invokeAgentTool() },
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
      __vfProviderReplayCheckpointMessageId: MESSAGE_ID,
      __vfProviderReplayInvokeAgentToolNames: ["invoke_agent"],
      __vfProviderReplayCheckpointTurnComplete: (invokeAgentToolCalls: unknown) => {
        completedBatch = invokeAgentToolCalls;
      },
    } as AgentConfig & RuntimeToolFilterConfig & {
      __vfProviderReplayInvokeAgentToolNames: string[];
    };

    try {
      await agent(config).generate({ input: "Delegate both tasks" });
    } finally {
      Array.isArray = originalIsArray;
    }

    assertEquals(completedBatch, [
      {
        toolCallId: "child-1",
        toolName: "invoke_agent",
        toolArgsJson: '{"task":"first"}',
      },
      {
        toolCallId: "child-2",
        toolName: "invoke_agent",
        toolArgsJson: '{"task":"second"}',
      },
    ]);
  });

  it("does not publish custom invoke_agent name collisions", async () => {
    let completedBatch: unknown = "not-called";
    const model = scriptedModel([{
      toolCalls: [
        { id: "custom-1", name: "invoke_agent", input: { task: "first" } },
        { id: "custom-2", name: "invoke_agent", input: { task: "second" } },
      ],
    }], {
      modelId: "anthropic/custom-invoke-agent-name-collision",
      provider: "anthropic",
      only: "generate",
    });
    const config = {
      id: "custom-invoke-agent-name-collision",
      model: "anthropic/custom-invoke-agent-name-collision",
      system: "Use the custom tool twice.",
      skills: false,
      tools: { invoke_agent: invokeAgentTool() },
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
      __vfProviderReplayCheckpointMessageId: MESSAGE_ID,
      __vfProviderReplayInvokeAgentToolNames: [],
      __vfProviderReplayCheckpointTurnComplete: (invokeAgentToolCalls: unknown) => {
        completedBatch = invokeAgentToolCalls;
      },
    } as AgentConfig & RuntimeToolFilterConfig & {
      __vfProviderReplayInvokeAgentToolNames: string[];
    };

    const setHas = Set.prototype.has;
    Set.prototype.has = () => true;
    try {
      await agent(config).generate({ input: "Call both custom tools" });
    } finally {
      Set.prototype.has = setHas;
    }

    assertEquals(completedBatch, undefined);
  });

  for (const mode of ["generate", "stream"] as const) {
    for (const mutation of ["constructor", "add"] as const) {
      it(`rejects forged Set ${mutation} authorization in ${mode}`, async () => {
        let completedBatch: unknown = "not-called";
        const model = scriptedModel([{
          toolCalls: [
            { id: "custom-1", name: "invoke_agent", input: { task: "first" } },
            { id: "custom-2", name: "invoke_agent", input: { task: "second" } },
          ],
        }], {
          modelId: "anthropic/custom-invoke-agent-name-collision",
          provider: "anthropic",
          only: mode,
        });
        const config = {
          id: "custom-invoke-agent-name-collision",
          model: "anthropic/custom-invoke-agent-name-collision",
          system: "Use the custom tool twice.",
          skills: false,
          tools: { invoke_agent: invokeAgentTool() },
          maxSteps: 1,
          resolveModelTransport: () => ({ model }),
          __vfProviderReplayCheckpointMessageId: MESSAGE_ID,
          __vfProviderReplayInvokeAgentToolNames: mutation === "add"
            ? ["veryfront__invoke_agent"]
            : [],
          __vfProviderReplayCheckpointTurnComplete: (invokeAgentToolCalls: unknown) => {
            completedBatch = invokeAgentToolCalls;
          },
        } as AgentConfig & RuntimeToolFilterConfig & {
          __vfProviderReplayInvokeAgentToolNames: string[];
        };

        const OriginalSet = globalThis.Set;
        const originalAdd = OriginalSet.prototype.add;
        if (mutation === "constructor") {
          globalThis.Set = class<T> extends OriginalSet<T> {
            constructor(values?: Iterable<T> | null) {
              super(values);
              super.add("invoke_agent" as T);
            }
          };
        }
        if (mutation === "add") {
          OriginalSet.prototype.add = function (value) {
            if (value === "veryfront__invoke_agent") originalAdd.call(this, "invoke_agent");
            return originalAdd.call(this, value);
          };
        }
        try {
          const assistant = agent(config);
          if (mode === "generate") {
            await assistant.generate({ input: "Call both custom tools" });
          } else {
            await (await assistant.stream({ input: "Call both custom tools" }))
              .toDataStreamResponse().text();
          }
        } finally {
          globalThis.Set = OriginalSet;
          OriginalSet.prototype.add = originalAdd;
        }

        assertEquals(completedBatch, undefined);
      });
    }
  }
});
