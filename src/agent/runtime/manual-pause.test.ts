import { registerTurnProviderRequestValidator } from "#veryfront/agent/middleware/turn-validation.ts";
import { agentManualPauseBoundary } from "./manual-pause.ts";
import { createRunBoundAgentManualPause } from "../hosted/manual-pause-credential.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { ModelRuntime } from "#veryfront/provider/types.ts";
import { tool } from "#veryfront/tool";
import { AgentRuntime } from "./index.ts";
import type { AgentConfig, Message } from "../types.ts";
import type { RuntimeToolFilterConfig } from "./runtime-tool-config.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";

function userMessage(text: string): Message[] {
  return [{ id: "pause-input", role: "user", parts: [{ type: "text", text }] }];
}

describe("agent manual pause", () => {
  for (const [pauseStep, exhaustBudget] of [[1, false], [2, false], [1, true]] as const) {
    it(`parks at settled step ${pauseStep} and resumes without repeating it (budget=${exhaustBudget})`, async () => {
      let modelCalls = 0;
      let toolCalls = 0;
      let finishes = 0;
      let saved: unknown = null;
      let resumedTokens = 0;
      const model: ModelRuntime = {
        provider: "test",
        modelId: "test/manual-pause",
        async doGenerate() {
          throw new Error("Only streaming is used");
        },
        async doStream() {
          modelCalls++;
          const parts = modelCalls === 1 || exhaustBudget
            ? [{
              type: "tool-call",
              toolCallId: `charge-${modelCalls}`,
              toolName: "charge",
              input: {},
            }]
            : [{ type: "text-delta", text: "Done" }];
          return {
            stream: new ReadableStream<unknown>({
              start(controller) {
                for (const part of parts) controller.enqueue(part);
                controller.enqueue({
                  type: "finish",
                  finishReason: modelCalls === 1 || exhaustBudget ? "tool-calls" : "stop",
                  totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                });
                controller.close();
              },
            }),
          };
        },
      };
      const config = {
        memory: { type: "conversation" as const },
        model: "test/manual-pause",
        system: "Charge once and finish.",
        maxSteps: exhaustBudget ? 2 : 3,
        tools: {
          charge: tool({
            id: "charge",
            description: "Charge once",
            inputSchema: defineSchema((v) => v.object({}))(),
            execute: () => {
              toolCalls++;
              return { charged: true };
            },
          }),
        },
        resolveModelTransport: () => ({ model }),
      };
      const messages: Message[] = [{
        id: "request-1",
        role: "user",
        parts: [{ type: "text", text: "Go" }],
      }];
      const paused = new AgentRuntime("manual-pause", config, {
        manualPause: {
          load: async () => null,
          acknowledge: async (checkpoint: { nextStep: number }) => {
            if (checkpoint.nextStep !== pauseStep) return false;
            saved = structuredClone(checkpoint);
            return true;
          },
        },
      });
      const pausedBody = await new Response(
        await paused.stream(messages, undefined, {
          onFinish: () => finishes++,
        }),
      ).text();
      assertEquals(modelCalls, pauseStep);
      assertEquals(toolCalls, 1);
      assertEquals(finishes, 0);
      assertEquals(pausedBody.includes('"type":"message-finish"'), false);
      assertEquals(saved !== null, true);

      const resumed = new AgentRuntime("manual-pause", config, {
        manualPause: {
          load: async () => saved,
          acknowledge: async () => false,
        },
      });
      const resumedBody = await new Response(
        await resumed.stream(messages, undefined, {
          onFinish: (response) => {
            finishes++;
            resumedTokens = response.usage?.totalTokens ?? 0;
          },
        }),
      ).text();
      assertEquals(modelCalls, 2);
      assertEquals(toolCalls, exhaustBudget ? 2 : 1);
      const memory = await resumed.getMemory().getMessages();
      assertEquals(memory.some((message) => message.role === "tool"), true);
      assertEquals(memory.filter((message) => message.id === "request-1").length, 1);
      assertEquals(finishes, 1);
      assertEquals(resumedTokens, 4);
      assertEquals(resumedBody.includes("Done"), !exhaustBudget);
    });
  }
});

for (const pauseStep of [1, 2]) {
  it(`retains deferred tool exposure and empty-response recovery at step ${pauseStep}`, async () => {
    const model = scriptedModel([
      { toolCalls: [{ id: "search-1", name: "tool_search", input: { query: "read_marker" } }] },
      {
        parts: [{
          type: "finish",
          finishReason: "stop",
          totalUsage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
        }],
      },
      { toolCalls: [{ id: "marker-1", name: "read_marker", input: {} }] },
      { text: "Marker read." },
    ], { only: "stream" });
    let executions = 0;
    let saved: unknown = null;
    const config = {
      model: model.modelId,
      system: "Read a marker and report it.",
      maxSteps: 5,
      skills: false,
      __vfToolLoadingMode: "deferred",
      tools: {
        read_marker: tool({
          id: "read_marker",
          description: "Read the marker",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => {
            executions++;
            return { marker: "one" };
          },
        }),
      },
      resolveModelTransport: () => ({ model }),
    } as AgentConfig & RuntimeToolFilterConfig;
    const messages: Message[] = [{
      id: "request",
      role: "user",
      parts: [{ type: "text", text: "Read marker" }],
    }];
    const paused = new AgentRuntime("marker", config, {
      manualPause: {
        load: async () => null,
        acknowledge: async (checkpoint) => {
          if (checkpoint.nextStep !== pauseStep) return false;
          saved = structuredClone(checkpoint);
          return true;
        },
      },
    });
    await new Response(await paused.stream(messages)).text();
    assertEquals(model.callCount, pauseStep);
    const resumed = new AgentRuntime("marker", config, {
      manualPause: {
        load: async () => saved,
        acknowledge: async () => false,
      },
    });
    const body = await new Response(await resumed.stream(messages)).text();
    assertEquals(executions, 1);
    assertEquals(model.callCount, 4);
    assertEquals(model.toolNames(pauseStep).includes("read_marker"), true);
    assertEquals(body.includes("Marker read."), true);
  });
}

it("retains a trusted skill's delegation defaults across pause", async () => {
  const model = scriptedModel([
    { toolCalls: [{ id: "load-1", name: "load_skill", input: {} }] },
    {
      toolCalls: [{
        id: "delegate-1",
        name: "invoke_agent",
        input: { prompt: "Research", description: "Research" },
      }],
    },
    { text: "Researched." },
  ], { only: "stream" });
  let delegated: unknown;
  let saved: unknown;
  const config = {
    model: model.modelId,
    system: "Load and delegate.",
    maxSteps: 4,
    tools: {
      load_skill: tool({
        id: "load_skill",
        description: "Load research skill",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () => ({
          skillId: "research",
          instructions: "Research",
          references: [],
          scripts: [],
          model: "opus",
          thinking: false,
          maxSteps: 160,
        }),
      }),
      invoke_agent: tool({
        id: "invoke_agent",
        description: "Delegate research",
        inputSchema: defineSchema((v) =>
          v.object({
            prompt: v.string(),
            description: v.string(),
            model: v.string().optional(),
            thinking: v.number().optional(),
            max_steps: v.number().optional(),
          })
        )(),
        execute: (input) => {
          delegated = input;
          return { answer: "done" };
        },
      }),
    },
    resolveModelTransport: () => ({ model }),
  };
  const messages: Message[] = [{
    id: "request",
    role: "user",
    parts: [{ type: "text", text: "Research" }],
  }];
  const paused = new AgentRuntime("delegation", config, {
    preserveToolCatalog: true,
    manualPause: {
      load: async () => null,
      acknowledge: async (checkpoint) => {
        if (checkpoint.nextStep !== 1) return false;
        saved = structuredClone(checkpoint);
        return true;
      },
    },
  });
  await new Response(await paused.stream(messages)).text();
  const resumed = new AgentRuntime("delegation", config, {
    preserveToolCatalog: true,
    manualPause: {
      load: async () => saved,
      acknowledge: async () => false,
    },
  });
  await new Response(await resumed.stream(messages)).text();
  assertEquals(delegated, {
    prompt: "Research",
    description: "Research",
    model: "opus",
    thinking: 0,
    max_steps: 160,
  });
  assertEquals(model.callCount, 3);
});

it("continues an unpaused run whose transcript exceeds the checkpoint budget", async () => {
  let finishes = 0;
  let acknowledgements = 0;
  const runtime = new AgentRuntime("large-unpaused", {
    model: "test/large-unpaused",
    system: "Reply Done.",
    maxSteps: 1,
    resolveModelTransport: () => ({
      model: scriptedModel([{ text: "Done" }], { only: "stream" }),
    }),
  }, {
    manualPause: {
      load: async () => null,
      requested: async () => false,
      acknowledge: async () => {
        acknowledgements++;
        return false;
      },
    },
  });
  const stream = await runtime.stream(
    [{
      id: "large-request",
      role: "user",
      parts: [{ type: "text", text: "x".repeat(3 * 1024 * 1024) }],
    }],
    undefined,
    {
      onFinish: () => {
        finishes++;
      },
    },
  );
  await new Response(stream).text();
  assertEquals(finishes, 1);
  assertEquals(acknowledgements, 0);
});

it("keeps an early pause from committing input before provider validation", async () => {
  const model = scriptedModel([{ text: "unreachable" }]);
  const runtime = new AgentRuntime("early-pause", {
    model: "test/pause",
    system: "Validate first",
    skills: false,
    memory: { type: "conversation" },
    middleware: [(context, next) => {
      registerTurnProviderRequestValidator(context, async () => {
        throw new Error("Rejected input");
      });
      return next();
    }],
    resolveModelTransport: () => ({ model }),
  }, {
    manualPause: {
      load: async () => {
        throw agentManualPauseBoundary();
      },
      acknowledge: async () => true,
    },
  });
  const body = await new Response(await runtime.stream(userMessage("Private unvalidated input")))
    .text();
  assertEquals(body.includes("data-veryfront.manual_pause"), true);
  assertEquals(await runtime.getMemory().getMessages(), []);
  assertEquals(model.callCount, 0);
});

it("restores private signed provider metadata after manual pause", async () => {
  const providerMetadata = {
    anthropic: {
      rawAssistantContent: [{ type: "thinking", thinking: "private", signature: "test-signature" }],
    },
  };
  const model = scriptedModel([
    { toolCalls: [{ id: "lookup-1", name: "lookup", input: {} }], providerMetadata },
    { text: "Done" },
  ], { provider: "anthropic", modelId: "claude-test", only: "stream" });
  const config = {
    model: "anthropic/claude-test",
    system: "Lookup once",
    skills: false,
    maxSteps: 2,
    tools: {
      lookup: tool({
        id: "lookup",
        description: "Lookup",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () => ({ done: true }),
      }),
    },
    resolveModelTransport: () => ({ model }),
  };
  let saved: unknown;
  const paused = new AgentRuntime("provider-pause", config, {
    manualPause: {
      load: async () => null,
      acknowledge: async (checkpoint) => {
        if (checkpoint.nextStep !== 1) return false;
        saved = structuredClone(checkpoint);
        return true;
      },
    },
  });
  await new Response(await paused.stream(userMessage("Lookup"))).text();
  const resumed = new AgentRuntime("provider-pause", config, {
    manualPause: { load: async () => saved, acknowledge: async () => false },
  });
  const body = await new Response(await resumed.stream(userMessage("Lookup"))).text();
  const prompt = model.calls[1]?.prompt ?? [];
  assertEquals(
    prompt.find((message) => message.role === "assistant")?.providerMetadata,
    providerMetadata,
  );
  assertEquals(body.includes("test-signature"), false);
});

it("holds an oversized pause until its dispatch stops without claiming confirmation", async () => {
  const model = scriptedModel([{ text: "unreachable" }]);
  const cancellation = new AbortController();
  let requested = false;
  let cancelled = false;
  let checkedHeldBoundary!: () => void;
  const heldBoundary = new Promise<void>((resolve) => checkedHeldBoundary = resolve);
  let releaseRequested = false;
  const authority = createRunBoundAgentManualPause({
    apiUrl: "https://api.example.com",
    runId: "run_oversized_pause",
    token: "pause-test-token",
    signal: cancellation.signal,
    fetch: (url, init) => {
      if (init?.method === "POST") {
        assertEquals(JSON.parse(String(init.body)), { checkpoint: null });
        releaseRequested = true;
        return Promise.resolve(Response.json({ stop: true }));
      }
      if (String(url).includes("?boundary=true")) {
        requested = true;
        if (releaseRequested) checkedHeldBoundary();
        return Promise.resolve(
          Response.json({ stop: cancelled, checkpoint: null, pauseRequested: requested }),
        );
      }
      return Promise.resolve(Response.json({ stop: false, checkpoint: null }));
    },
  });
  const runtime = new AgentRuntime("large-pause", {
    model: "test/pause",
    system: "Hold",
    skills: false,
    resolveModelTransport: () => ({ model }),
  }, { manualPause: authority });
  let settled = false;
  const response = new Response(await runtime.stream(userMessage("x".repeat(2 * 1024 * 1024))))
    .text();
  void response.then(() => settled = true);
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      heldBoundary,
      new Promise<never>((_, reject) => {
        watchdog = setTimeout(() => reject(new Error("Held boundary was not checked")), 2000);
      }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assertEquals(settled, false);
    assertEquals(requested, true);
    assertEquals(model.callCount, 0);
  } finally {
    clearTimeout(watchdog);
    cancelled = true;
    cancellation.abort();
  }
  const body = await response;
  assertEquals(body.includes("message-finish"), false);
  assertEquals(body.includes('"type":"error"'), false);
  assertEquals(model.callCount, 0);
});

it("continues oversized resumed progress after retiring the stale checkpoint", async () => {
  const model = scriptedModel([{ text: "Done" }]);
  let releases = 0;
  const runtime = new AgentRuntime("oversized-resume", {
    model: "test/pause",
    system: "Continue",
    skills: false,
    maxSteps: 1,
    resolveModelTransport: () => ({ model }),
  }, {
    manualPause: {
      load: async () => null,
      requested: async () => releases === 0,
      acknowledge: async () => {
        throw new Error("Oversized continuation must not be sent");
      },
      release: async () => {
        releases++;
        return false;
      },
    },
  });
  const body = await new Response(await runtime.stream(userMessage("x".repeat(2 * 1024 * 1024))))
    .text();
  assertEquals(releases, 1);
  assertEquals(model.callCount, 1);
  assertEquals(body.includes("message-finish"), true);
});

it("validates staged input before acknowledging an initial pause", async () => {
  const model = scriptedModel([{ text: "unreachable" }]);
  let acknowledgements = 0;
  const runtime = new AgentRuntime("validate-pause", {
    model: "test/pause",
    system: "Validate",
    skills: false,
    memory: { type: "conversation" },
    middleware: [(context, next) => {
      registerTurnProviderRequestValidator(context, async () => {
        throw new Error("Rejected input");
      });
      return next();
    }],
    resolveModelTransport: () => ({ model }),
  }, {
    manualPause: {
      load: async () => null,
      requested: async () => true,
      acknowledge: async () => {
        acknowledgements++;
        return true;
      },
    },
  });
  await new Response(await runtime.stream(userMessage("Unvalidated input"))).text();
  assertEquals(acknowledgements, 0);
  assertEquals(await runtime.getMemory().getMessages(), []);
  assertEquals(model.callCount, 0);
});
