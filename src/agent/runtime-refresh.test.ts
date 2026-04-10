import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type ModelRuntime } from "#veryfront/provider";
import { tool } from "#veryfront/tool";
import { z } from "zod";
import { agent } from "./index.ts";
import type { RuntimeStateRequest } from "./types.ts";

function createRuntimeStream(parts: unknown[]) {
  return new ReadableStream<unknown>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
      }
      controller.close();
    },
  });
}

function extractSystemPrompt(options: unknown): string {
  const prompt = (options as { prompt?: Array<{ role?: string; content?: unknown }> }).prompt;
  if (!Array.isArray(prompt)) {
    return "";
  }

  return prompt
    .filter((entry) => entry?.role === "system" && typeof entry.content === "string")
    .map((entry) => entry.content as string)
    .join("\n");
}

describe("agent runtime refresh hooks", () => {
  it("refreshes system and context at step boundaries for generate()", async () => {
    const runtimeRequests: RuntimeStateRequest[] = [];
    const observedSystems: string[] = [];
    const inspectedContexts: Array<Record<string, unknown> | undefined> = [];
    let callCount = 0;

    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/runtime-refresh-generate",
      async doGenerate(options: unknown) {
        callCount++;
        observedSystems.push(extractSystemPrompt(options));

        if (callCount === 1) {
          return {
            content: [{
              type: "tool-call",
              toolCallId: "switch-1",
              toolName: "switch_project",
              input: '{"projectId":"project-b"}',
            }],
            finishReason: "tool-calls",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        }

        if (callCount === 2) {
          return {
            content: [{
              type: "tool-call",
              toolCallId: "inspect-1",
              toolName: "inspect_context",
              input: "{}",
            }],
            finishReason: "tool-calls",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        }

        return {
          content: [{ type: "text", text: "done" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: createRuntimeStream([{ type: "finish", finishReason: "stop" }]) };
      },
    };

    const switchProject = tool({
      id: "switch_project",
      description: "Switch the active project context",
      inputSchema: z.object({ projectId: z.string() }),
      execute: async ({ projectId }) => ({ projectId }),
    });

    const inspectContext = tool({
      id: "inspect_context",
      description: "Inspect the current runtime context",
      inputSchema: z.object({}),
      execute: async (_input, context) => {
        inspectedContexts.push(context as Record<string, unknown> | undefined);
        return {
          projectId: context?.projectId,
          steeringRevision: context?.steeringRevision,
        };
      },
    });

    const assistant = agent({
      model: "hosted/runtime-refresh-generate",
      system: "Base system prompt",
      tools: {
        switch_project: switchProject,
        inspect_context: inspectContext,
      },
      resolveModelTransport: async () => ({ model }),
      resolveRuntimeState: async (request) => {
        runtimeRequests.push(request);

        if (request.step === 0) {
          return undefined;
        }

        return {
          system: "Refreshed system prompt",
          context: {
            projectId: "project-b",
            steeringRevision: 1,
          },
        };
      },
    });

    const result = await assistant.generate({
      input: "Switch to project b and inspect the active context",
      context: { projectId: "project-a" },
    });

    assertEquals(result.text, "done");
    assertEquals(runtimeRequests.map((request) => request.step), [0, 1, 2]);
    assertEquals(observedSystems, [
      "Base system prompt",
      "Refreshed system prompt",
      "Refreshed system prompt",
    ]);

    const secondRequest = runtimeRequests[1];
    assertExists(secondRequest);
    assertEquals(secondRequest.context, { projectId: "project-a" });
    assertEquals(
      secondRequest.messages.some((message) =>
        message.role === "tool" &&
        message.parts.some((part) =>
          part.type === "tool-result" &&
          part.toolCallId === "switch-1" &&
          part.toolName === "switch_project"
        )
      ),
      true,
    );

    assertEquals(inspectedContexts.length, 1);
    assertEquals(inspectedContexts[0]?.projectId, "project-b");
    assertEquals(inspectedContexts[0]?.steeringRevision, 1);
  });

  it("refreshes the streaming system prompt between hosted run steps", async () => {
    const runtimeRequests: RuntimeStateRequest[] = [];
    const observedSystems: string[] = [];
    let callCount = 0;

    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/runtime-refresh-stream",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream(options: unknown) {
        callCount++;
        observedSystems.push(extractSystemPrompt(options));

        if (callCount === 1) {
          return {
            stream: createRuntimeStream([
              {
                type: "tool-call",
                toolCallId: "switch-stream-1",
                toolName: "switch_project",
                input: '{"projectId":"project-b"}',
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                usage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        return {
          stream: createRuntimeStream([
            { type: "text-delta", text: "stream done" },
            { type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } },
          ]),
        };
      },
    };

    const switchProject = tool({
      id: "switch_project",
      description: "Switch the active project context",
      inputSchema: z.object({ projectId: z.string() }),
      execute: async ({ projectId }) => ({ projectId }),
    });

    const assistant = agent({
      model: "hosted/runtime-refresh-stream",
      system: "Base streaming system prompt",
      tools: { switch_project: switchProject },
      resolveModelTransport: async () => ({ model }),
      resolveRuntimeState: async (request) => {
        runtimeRequests.push(request);

        if (request.step === 0) {
          return undefined;
        }

        return {
          system: "Refreshed streaming system prompt",
          context: { projectId: "project-b" },
        };
      },
    });

    const response = (await assistant.stream({
      input: "Switch to project b",
      context: { projectId: "project-a" },
    })).toDataStreamResponse();

    const body = await response.text();

    assertEquals(runtimeRequests.map((request) => request.step), [0, 1]);
    assertEquals(observedSystems, [
      "Base streaming system prompt",
      "Refreshed streaming system prompt",
    ]);
    assertEquals(body.includes("stream done"), true);
  });
});
