import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { defineSchema } from "#veryfront/schemas";
import { tool } from "#veryfront/tool";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
} from "#veryfront/utils/logger/index.ts";
import { agent } from "../index.ts";
import type { AgentConfig } from "../types.ts";
import type { RuntimeToolFilterConfig } from "./runtime-tool-config.ts";

function toolNames(options: unknown): string[] {
  const value = (options as { tools?: unknown }).tools;
  return Array.isArray(value)
    ? value.map((tool) =>
      (tool as { name?: string; id?: string }).name ??
        (tool as { name?: string; id?: string }).id ?? ""
    ).sort()
    : Object.keys((value as Record<string, unknown> | undefined) ?? {}).sort();
}

it("deferred generate searches, exposes on the next step, and executes once", async () => {
  const observedTools: string[][] = [];
  let step = 0;
  const model: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/deferred-tools",
    async doGenerate(options: unknown) {
      observedTools.push(toolNames(options));
      step++;
      if (step === 1) {
        return {
          content: [{
            type: "tool-call",
            toolCallId: "search-1",
            toolName: "tool_search",
            input: JSON.stringify({ query: "release marker" }),
          }],
          finishReason: "tool-calls",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      }
      if (step === 2) {
        return {
          content: [{
            type: "tool-call",
            toolCallId: "marker-1",
            toolName: "read_release_marker",
            input: "{}",
          }],
          finishReason: "tool-calls",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      }
      return {
        content: [{ type: "text", text: "Release marker marker-1" }],
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
  let executionCount = 0;
  const assistant = agent(
    {
      id: "deferred-runtime-test",
      model: "hosted/deferred-tools",
      system: "Use tools when needed.",
      tools: {
        form_input: tool({
          id: "form_input",
          description: "Collect input",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({}),
        }),
        load_skill: tool({
          id: "load_skill",
          description: "Load a skill",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({}),
        }),
        read_release_marker: tool({
          id: "read_release_marker",
          description: "Read the release marker",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => {
            executionCount++;
            return { marker: "marker-1" };
          },
        }),
      },
      maxSteps: 4,
      resolveModelTransport: () => ({ model }),
      __vfToolLoadingMode: "deferred",
    } as AgentConfig & RuntimeToolFilterConfig,
  );

  const response = await assistant.generate({ input: "Read the release marker" });

  assertEquals(observedTools[0], ["form_input", "load_skill", "tool_search"]);
  assertEquals(observedTools[1], [
    "form_input",
    "load_skill",
    "read_release_marker",
  ]);
  assertEquals(executionCount, 1);
  assertEquals(response.text, "Release marker marker-1");
});

it("deferred generate rejects a guessed tool that was not exposed", async () => {
  let step = 0;
  let executionCount = 0;
  const model: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/deferred-guessed-tool",
    async doGenerate() {
      step++;
      if (step === 1) {
        return {
          content: [{
            type: "tool-call",
            toolCallId: "guessed-1",
            toolName: "get_release",
            input: "{}",
          }],
          finishReason: "tool-calls",
        };
      }
      return {
        content: [{ type: "text", text: "done" }],
        finishReason: "stop",
      };
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
  const assistant = agent(
    {
      id: "deferred-guessed-generate",
      model: "hosted/deferred-guessed-tool",
      system: "Use tools when needed.",
      skills: false,
      tools: {
        get_release: tool({
          id: "get_release",
          description: "Get the current release",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => {
            executionCount++;
            return { id: "rel-1" };
          },
        }),
      },
      maxSteps: 2,
      resolveModelTransport: () => ({ model }),
      __vfToolLoadingMode: "deferred",
    } as AgentConfig & RuntimeToolFilterConfig,
  );

  const response = await assistant.generate({ input: "Find the current release" });

  assertEquals(executionCount, 0);
  assertEquals(response.toolCalls[0]?.status, "error");
  assertEquals(
    response.toolCalls[0]?.error,
    'Tool "get_release" is not available in the current model step',
  );
});
