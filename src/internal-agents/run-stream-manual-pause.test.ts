import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import { COMPLETED_AGENT_STEP_STATE_KEY } from "#veryfront/agent/runtime/runtime-tool-config.ts";
import {
  attachProviderMetadata,
  readAttachedProviderMetadata,
} from "#veryfront/agent/runtime/provider-metadata.ts";
import { convertToTextGenerationRuntimeMessages } from "#veryfront/agent/runtime/text-generation-runtime-message-converter.ts";
import { isRuntimeGeneratedUserMessage } from "#veryfront/agent/runtime/runtime-message-origin.ts";
import { hasSubmittedFormInputResult } from "#veryfront/agent/runtime/skill-policy-enforcement.ts";
import { hydrateActiveSkillStateFromMessages } from "#veryfront/agent/runtime/skill-policy-enforcement.ts";
import { agent as createAgent } from "#veryfront/agent";
import type { ModelRuntime, ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import { tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Agent } from "#veryfront/agent";
import type {
  CompletedAgentStep,
  RuntimeToolFilterConfig,
} from "#veryfront/agent/runtime/runtime-tool-config.ts";
import {
  getCompletedStepLoopState,
  getCompletedStepReplayMessages,
  getInternalAgentStreamRequestSchema,
  type RuntimeRunAgentInput,
  toRuntimeRunAgentInput,
} from "./schema.ts";
import { buildCompletedStepPauseCheckpoint } from "./completed-step-pause.ts";
import { AgentRunSessionManager } from "./session-manager.ts";
import * as host from "./run-stream.ts";

function fixture() {
  const input: RuntimeRunAgentInput = {
    threadId: crypto.randomUUID(),
    runId: "run_pause",
    messages: [],
    tools: [],
    context: [],
  };
  const agent = {
    id: "pause",
    config: { id: "pause", system: "test", model: "anthropic/claude-sonnet-4-6" },
  } as Agent;
  return { input, agent, sessionManager: new AgentRunSessionManager() };
}

const loopState = {
  agentWriteFinalResponseGuard: false,
  hasCompletedTool: true,
  recoveredEmptyResponse: false,
  recoveredInterruptedLocalToolBatch: false,
  hasSubmittedFormInput: false,
  runtimeGeneratedMessageIndexes: [],
};

const completedStep: CompletedAgentStep = {
  messages: [{ id: "retained-1", role: "assistant", parts: [{ type: "text", text: "retained" }] }],
  completedSteps: 1,
  loopState,
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
};

describe("internal agent completed-step manual pause", () => {
  for (const corrupt of ["runId", "completedSteps", "missing"] as const) {
    it(`rejects a ${corrupt} checkpoint binding and removes the private marker`, () => {
      const { input } = fixture();
      const checkpoint = buildCompletedStepPauseCheckpoint(input, {
        ...completedStep,
        messages: [attachProviderMetadata({ ...completedStep.messages[0]! }, {
          google: { rawAssistantParts: [{ thoughtSignature: "private-invalid-signature" }] },
        })],
      });
      const messages = checkpoint.replayMessages as Record<string, unknown>[];
      const metadata = messages[0]!.metadata as Record<string, unknown>;
      const state = metadata[COMPLETED_AGENT_STEP_STATE_KEY] as Record<string, unknown>;
      if (corrupt === "missing") delete metadata[COMPLETED_AGENT_STEP_STATE_KEY];
      else state[corrupt] = corrupt === "runId" ? "other-run" : 2;
      const parsed = getInternalAgentStreamRequestSchema().parse({
        agentId: "pause",
        threadId: input.threadId,
        runId: input.runId,
        runtimeTargetKind: "main_branch",
        runtimeTargetEnvironmentId: null,
        runtimeTargetBranchId: null,
        agentSource: { type: "branch", branch: "main" },
        messages,
        completedAgentSteps: 1,
      });
      const resumed = toRuntimeRunAgentInput(parsed);
      assertThrows(() => getCompletedStepLoopState(resumed, 1), Error, "checkpoint binding");
      assertEquals(
        JSON.stringify(resumed.messages).includes(COMPLETED_AGENT_STEP_STATE_KEY),
        false,
      );
      const replay = getCompletedStepReplayMessages(resumed)!;
      assertEquals(JSON.stringify(replay).includes("private-invalid-signature"), false);
      assertEquals(readAttachedProviderMetadata(replay[0]!), undefined);
    });
  }

  it("retains private Gemini tool-turn signatures through signed manual resume", async () => {
    const { input, agent, sessionManager } = fixture();
    const providerMetadata = {
      google: {
        rawAssistantParts: [{
          functionCall: { name: "lookup", args: {} },
          thoughtSignature: "retained-signature",
        }],
      },
    };
    const original = attachProviderMetadata({
      id: "signed-turn",
      role: "assistant" as const,
      parts: [{ type: "tool-lookup", toolName: "lookup", toolCallId: "call-1", args: {} }],
    }, providerMetadata);
    const checkpoint = JSON.parse(JSON.stringify(buildCompletedStepPauseCheckpoint(input, {
      ...completedStep,
      messages: [original],
    })));
    const envelope = getInternalAgentStreamRequestSchema().parse({
      agentId: "pause",
      threadId: input.threadId,
      runId: input.runId,
      runtimeTargetKind: "main_branch",
      runtimeTargetEnvironmentId: null,
      runtimeTargetBranchId: null,
      agentSource: { type: "branch", branch: "main" },
      messages: checkpoint.replayMessages,
      completedAgentSteps: 1,
    });
    const resumed = toRuntimeRunAgentInput(envelope);
    host.registerRuntimeCompletedStepBoundary(resumed, () => Promise.resolve(false), 1);
    let checked = false;
    const response = await host.createRuntimeAgentStreamResponse(resumed, agent, {
      sessionManager,
      createRuntime: () => ({
        stream: (messages) => {
          assertEquals(readAttachedProviderMetadata(messages[0]!), providerMetadata);
          const request = convertToTextGenerationRuntimeMessages(messages);
          const turn = request[0];
          assertEquals(
            turn && "providerMetadata" in turn ? turn.providerMetadata : undefined,
            providerMetadata,
          );
          assertEquals(JSON.stringify(messages).includes("retained-signature"), false);
          checked = true;
          return Promise.resolve(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.close();
              },
            }),
          );
        },
      }),
    });
    await response.text();
    assertEquals(checked, true);
  });

  it("carries restored Gemini signatures through the production SDK clone chain", async () => {
    const { input, sessionManager } = fixture();
    const providerMetadata = {
      google: {
        rawAssistantParts: [{
          functionCall: { name: "lookup", args: {} },
          thoughtSignature: "sdk-retained-signature",
        }],
      },
    };
    const original = attachProviderMetadata({
      id: "signed-sdk-turn",
      role: "assistant" as const,
      parts: [{ type: "tool-lookup", toolName: "lookup", toolCallId: "sdk-call-1", args: {} }],
    }, providerMetadata);
    const checkpoint = JSON.parse(JSON.stringify(buildCompletedStepPauseCheckpoint(input, {
      ...completedStep,
      messages: [original, {
        id: "settled-result",
        role: "tool",
        parts: [{
          type: "tool-result",
          toolCallId: "sdk-call-1",
          toolName: "lookup",
          result: { found: true },
        }],
      }],
    })));
    const parsed = getInternalAgentStreamRequestSchema().parse({
      agentId: "pause",
      threadId: input.threadId,
      runId: input.runId,
      runtimeTargetKind: "main_branch",
      runtimeTargetEnvironmentId: null,
      runtimeTargetBranchId: null,
      agentSource: { type: "branch", branch: "main" },
      messages: checkpoint.replayMessages,
      completedAgentSteps: 1,
    });
    let modelCalls = 0;
    const model = scriptedModel([(options) => {
      modelCalls++;
      assertEquals(JSON.stringify(options).includes("sdk-retained-signature"), true);
      return { text: "Finished" };
    }], { provider: "google", modelId: "google/paused-signature", only: "stream" });
    const agent = createAgent({
      id: "pause",
      model: "google/paused-signature",
      system: "Finish",
      maxSteps: 3,
      resolveModelTransport: () => Promise.resolve({ model }),
    });
    const resumed = toRuntimeRunAgentInput(parsed);
    host.registerRuntimeCompletedStepBoundary(resumed, () => Promise.resolve(false), 1);
    const response = await host.createRuntimeAgentStreamResponse(resumed, agent, {
      sessionManager,
    });
    const body = await response.text();
    assertEquals(modelCalls, 1);
    assertEquals(body.includes("event: RunFinished"), true);
    assertEquals(body.includes("event: RunError"), false);
    assertEquals(body.includes("sdk-retained-signature"), false);
  });

  it("hydrates a retained structured skill result on manual resume", async () => {
    const { agent, sessionManager } = fixture();
    const result = {
      skillId: "retained-skill",
      instructions: "Retained instructions",
      references: ["references/guide.md"],
      scripts: ["scripts/run.sh"],
    };
    const envelope = getInternalAgentStreamRequestSchema().parse({
      agentId: "pause",
      threadId: crypto.randomUUID(),
      runId: "run_pause",
      runtimeTargetKind: "main_branch",
      runtimeTargetEnvironmentId: null,
      runtimeTargetBranchId: null,
      agentSource: { type: "branch", branch: "main" },
      completedAgentSteps: 1,
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "tool-call", toolCallId: "skill-1", toolName: "load_skill", args: {} }],
        },
        {
          id: "tool-1",
          role: "tool",
          metadata: {
            [COMPLETED_AGENT_STEP_STATE_KEY]: {
              runId: "run_pause",
              completedSteps: 1,
              ...loopState,
            },
          },
          parts: [{ type: "tool-result", toolCallId: "skill-1", toolName: "load_skill", result }],
        },
      ],
    });
    const input = toRuntimeRunAgentInput(envelope);
    host.registerRuntimeCompletedStepBoundary(input, () => Promise.resolve(false), 1);
    let checked = false;
    const response = await host.createRuntimeAgentStreamResponse(input, agent, {
      sessionManager,
      createRuntime: () => ({
        stream: (messages) => {
          const hydrated = hydrateActiveSkillStateFromMessages(messages);
          assertEquals(hydrated.activeSkillId, "retained-skill");
          assertEquals(hydrated.activeSkillToolAvailability.references, ["references/guide.md"]);
          assertEquals(hydrated.activeSkillToolAvailability.scripts, ["scripts/run.sh"]);
          checked = true;
          return Promise.resolve(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.close();
              },
            }),
          );
        },
      }),
    });
    await response.text();
    assertEquals(checked, true);
  });

  for (const guard of [false, true]) {
    it(`restores this run's write guard ${guard} without inferring prior-turn writes`, async () => {
      const { input, agent, sessionManager } = fixture();
      const checkpoint = buildCompletedStepPauseCheckpoint(input, {
        ...completedStep,
        loopState: { ...loopState, agentWriteFinalResponseGuard: guard },
        messages: [
          {
            id: "old-write",
            role: "tool",
            parts: [{
              type: "tool-result",
              toolCallId: "old-write-1",
              toolName: "create_agent",
              result: { id: "prior-turn-agent" },
            }],
          },
          { id: "current-user", role: "user", parts: [{ type: "text", text: "Current turn" }] },
          ...completedStep.messages,
        ],
      });
      const envelope = getInternalAgentStreamRequestSchema().parse({
        agentId: "pause",
        threadId: input.threadId,
        runId: input.runId,
        runtimeTargetKind: "main_branch",
        runtimeTargetEnvironmentId: null,
        runtimeTargetBranchId: null,
        agentSource: { type: "branch", branch: "main" },
        messages: checkpoint.replayMessages,
        completedAgentSteps: 1,
      });
      const resumed = toRuntimeRunAgentInput(envelope);
      host.registerRuntimeCompletedStepBoundary(resumed, () => Promise.resolve(false), 1);
      let checked = false;
      const response = await host.createRuntimeAgentStreamResponse(resumed, agent, {
        sessionManager,
        createRuntime: (runtimeAgent) => ({
          stream: () => {
            assertEquals(
              (runtimeAgent.config as RuntimeToolFilterConfig).__vfCompletedStepState
                ?.agentWriteFinalResponseGuard,
              guard,
            );
            checked = true;
            return Promise.resolve(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.close();
                },
              }),
            );
          },
        }),
      });
      await response.text();
      assertEquals(checked, true);
    });
  }

  it("restores trusted skill settings and runtime-note provenance through the host", async () => {
    const { input, agent, sessionManager } = fixture();
    const settings = { model: "anthropic/claude-sonnet-4-6", thinking: 1024, maxSteps: 8 };
    const checkpoint = buildCompletedStepPauseCheckpoint(input, {
      ...completedStep,
      loopState: {
        ...loopState,
        activeSkillDelegationOverrides: settings,
        hasSubmittedFormInput: true,
        runtimeGeneratedMessageIndexes: [2],
        recoveredInterruptedLocalToolBatch: true,
        interruptedLocalToolBatchRecoveryStep: 1,
        interruptedLocalToolBatchRecoveryText: "Created the assistant.",
      },
      messages: [
        { id: "user-1", role: "user", parts: [{ type: "text", text: "Submit" }] },
        {
          id: "form-1",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "form-1",
            toolName: "form_input",
            result: { submitted: true, values: { name: "Saved" } },
          }],
        },
        {
          id: "runtime-note",
          role: "user",
          parts: [{ type: "text", text: "Continue after empty response" }],
        },
        ...completedStep.messages,
      ],
    });
    const envelope = getInternalAgentStreamRequestSchema().parse({
      agentId: "pause",
      threadId: input.threadId,
      runId: input.runId,
      runtimeTargetKind: "main_branch",
      runtimeTargetEnvironmentId: null,
      runtimeTargetBranchId: null,
      agentSource: { type: "branch", branch: "main" },
      messages: checkpoint.replayMessages,
      completedAgentSteps: 1,
    });
    const resumed = toRuntimeRunAgentInput(envelope);
    host.registerRuntimeCompletedStepBoundary(resumed, () => Promise.resolve(false), 1);
    let checked = false;
    const response = await host.createRuntimeAgentStreamResponse(resumed, agent, {
      sessionManager,
      createRuntime: (runtimeAgent) => ({
        stream: (messages) => {
          assertEquals(
            (runtimeAgent.config as RuntimeToolFilterConfig).__vfCompletedStepState
              ?.activeSkillDelegationOverrides,
            settings,
          );
          assertEquals(
            (runtimeAgent.config as RuntimeToolFilterConfig).__vfCompletedStepState
              ?.interruptedLocalToolBatchRecoveryStep,
            1,
          );
          assertEquals(
            (runtimeAgent.config as RuntimeToolFilterConfig).__vfCompletedStepState
              ?.interruptedLocalToolBatchRecoveryText,
            "Created the assistant.",
          );
          assertEquals(isRuntimeGeneratedUserMessage(messages[2]!), true);
          assertEquals(hasSubmittedFormInputResult(messages), true);
          checked = true;
          return Promise.resolve(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.close();
              },
            }),
          );
        },
      }),
    });
    await response.text();
    assertEquals(checked, true);
  });

  it("returns a private boundary after the invocation without public success", async () => {
    const { input, agent, sessionManager } = fixture();
    const bind = Reflect.get(host, "registerRuntimeCompletedStepBoundary") as (
      input: RuntimeRunAgentInput,
      callback: (step: CompletedAgentStep, signal: AbortSignal) => Promise<boolean>,
      completedSteps?: number,
    ) => void;
    assertEquals(typeof bind, "function");
    let acknowledgements = 0;
    bind(input, (step, signal) => {
      assertEquals(step.completedSteps, 1);
      assertEquals(signal.aborted, false);
      acknowledgements++;
      return Promise.resolve(true);
    });
    const response = await host.createRuntimeAgentStreamResponse(input, agent, {
      sessionManager,
      createRuntime: (runtimeAgent) => ({
        stream: async () => {
          const boundary =
            (runtimeAgent.config as RuntimeToolFilterConfig).__vfCompletedStepBoundary;
          assertEquals(typeof boundary, "function");
          assertEquals(await boundary!(completedStep), true);
          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.close();
            },
          });
        },
      }),
    });
    const body = await response.text();
    assertEquals(acknowledgements, 1);
    assertEquals(body.includes("event: RunFinished\n"), false);
    assertEquals(body.includes("event: RunError\n"), false);
    assertEquals(body.includes("event: AgentRunCompletedStepBoundary\n"), true);
    // Completed local invocation sessions are removed; the canonical run stays paused.
    assertEquals(sessionManager.getRunStatus(input.runId), null);
  });

  it("replaces authored boundary hooks and offsets with verified host bindings", async () => {
    const { input, agent, sessionManager } = fixture();
    const config = agent.config as RuntimeToolFilterConfig;
    config.__vfCompletedStepBoundary = () => Promise.resolve(true);
    config.__vfCompletedSteps = 99;
    config.__vfCompletedStepState = { ...loopState, agentWriteFinalResponseGuard: true };
    const response = await host.createRuntimeAgentStreamResponse(input, agent, {
      sessionManager,
      createRuntime: (runtimeAgent) => ({
        stream: () => {
          const runtimeConfig = runtimeAgent.config as RuntimeToolFilterConfig;
          assertEquals(runtimeConfig.__vfCompletedStepBoundary, undefined);
          assertEquals(runtimeConfig.__vfCompletedSteps, 0);
          assertEquals(runtimeConfig.__vfCompletedStepState, undefined);
          return Promise.resolve(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.close();
              },
            }),
          );
        },
      }),
    });
    await response.text();
  });
  it("does not confirm a pause when the acknowledged invocation still fails", async () => {
    const { input, agent, sessionManager } = fixture();
    host.registerRuntimeCompletedStepBoundary(input, () => Promise.resolve(true));
    const response = await host.createRuntimeAgentStreamResponse(input, agent, {
      sessionManager,
      createRuntime: (runtimeAgent) => ({
        stream: async () => {
          await (runtimeAgent.config as RuntimeToolFilterConfig).__vfCompletedStepBoundary!(
            completedStep,
          );
          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(new Error("invocation failed"));
            },
          });
        },
      }),
    });
    const body = await response.text();
    assertEquals(body.includes("event: RunError\n"), true);
    assertEquals(body.includes("event: AgentRunCompletedStepBoundary\n"), false);
  });
  for (const deferred of [false, true]) {
    it(`composes SDK pause and resume with ${deferred ? "deferred" : "eager"} tools`, async () => {
      const { input, sessionManager } = fixture();
      let calls = 0;
      let writes = 0;
      const model: ModelRuntime<ModelRuntimeCallOptions> = {
        provider: "test",
        modelId: "test/host-boundary",
        executionMode: "remote",
        doGenerate() {
          throw new Error("stream only");
        },
        doStream(options) {
          calls++;
          if (calls === (deferred ? 3 : 2)) {
            assertEquals(JSON.stringify(options).includes("write-1"), true);
            assertEquals(JSON.stringify(options).includes("writes"), true);
            return Promise.resolve({
              stream: new ReadableStream<unknown>({
                start(controller) {
                  controller.enqueue({ type: "text-start", id: "resumed" });
                  controller.enqueue({ type: "text-delta", id: "resumed", delta: "Finished" });
                  controller.enqueue({ type: "text-end", id: "resumed" });
                  controller.enqueue({
                    type: "finish",
                    finishReason: "stop",
                    totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                  });
                  controller.close();
                },
              }),
            });
          }
          return Promise.resolve({
            stream: new ReadableStream<unknown>({
              start(controller) {
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: deferred && calls === 1 ? "search-1" : "write-1",
                  toolName: deferred && calls === 1 ? "tool_search" : "write",
                  input: deferred && calls === 1 ? { query: "write" } : {},
                });
                controller.enqueue({
                  type: "finish",
                  finishReason: "tool-calls",
                  totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                });
                controller.close();
              },
            }),
          });
        },
      };
      const agent = createAgent({
        id: "pause",
        model: "test/host-boundary",
        system: "Write once",
        maxSteps: 3,
        ...(deferred ? { __vfToolLoadingMode: "deferred" as const } : {}),
        tools: {
          write: tool({
            id: "write",
            description: "Records a write",
            inputSchema: defineSchema((v) => v.object({}))(),
            execute: () => ({ writes: ++writes }),
          }),
        },
        resolveModelTransport: () => Promise.resolve({ model }),
      });
      let retained: CompletedAgentStep | undefined;
      host.registerRuntimeCompletedStepBoundary(input, (step) => {
        retained = step;
        return Promise.resolve(true);
      });
      const response = await host.createRuntimeAgentStreamResponse(input, agent, {
        sessionManager,
      });
      const body = await response.text();
      assertEquals(calls, 1);
      assertEquals(writes, deferred ? 0 : 1);
      assertEquals(retained?.completedSteps, 1);
      assertEquals(
        JSON.stringify(retained?.messages).includes(deferred ? "search-1" : '"writes":1'),
        true,
      );
      if (deferred) assertEquals(retained?.toolExposureCheckpoint?.loadedToolNames, ["write"]);
      assertEquals(body.includes("event: RunFinished\n"), false);
      assertEquals(body.includes("event: RunError\n"), false);
      assertEquals(body.includes("event: AgentRunCompletedStepBoundary\n"), true);
      const checkpoint = buildCompletedStepPauseCheckpoint(input, retained!);
      const envelope = getInternalAgentStreamRequestSchema().parse({
        agentId: "pause",
        threadId: input.threadId,
        runId: input.runId,
        runtimeTargetKind: "main_branch",
        runtimeTargetEnvironmentId: null,
        runtimeTargetBranchId: null,
        agentSource: { type: "branch", branch: "main" },
        messages: checkpoint.replayMessages,
        context: checkpoint.context,
        completedAgentSteps: checkpoint.completedSteps,
        serverResolvedToolExposureCheckpoint: checkpoint.toolExposureCheckpoint,
        serverResolvedPreParkUsage: checkpoint.preParkUsage,
      });
      const resumed = toRuntimeRunAgentInput(envelope);
      host.registerRuntimeCompletedStepBoundary(
        resumed,
        () => Promise.resolve(false),
        envelope.completedAgentSteps,
        envelope.serverResolvedToolExposureCheckpoint,
      );
      const resumedResponse = await host.createRuntimeAgentStreamResponse(resumed, agent, {
        sessionManager,
      });
      const resumedBody = await resumedResponse.text();
      assertEquals(calls, deferred ? 3 : 2);
      assertEquals(writes, 1);
      assertEquals(resumedBody.includes("event: RunFinished\n"), true);
      assertEquals(resumedBody.includes("event: RunError\n"), false);
    });
  }
});
