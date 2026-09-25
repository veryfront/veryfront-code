/**
 * Regression coverage for the discarded post-delegation model call
 * (veryfront-issue-inbox#1815).
 *
 * When the control plane declares `invoke_agent`, it parks the run after the
 * runtime emits the tool call and runs the child itself. The runtime must wait
 * for the submitted result instead of executing a config-owned local
 * `invoke_agent` and starting another billed model step, and a park cancel must
 * abort a model call that is already in flight.
 */

import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { delay, waitFor } from "#veryfront/testing/deno-compat.ts";
import { agent as createAgent } from "#veryfront/agent";
import { isFrameworkInvokeAgentTool } from "#veryfront/agent/runtime/agent-delegation.ts";
import { tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import { AgentRunSessionManager } from "./session-manager.ts";
import { buildMergedTools, createRuntimeAgentStreamResponse } from "./run-stream.ts";

type RunInput = Parameters<typeof createRuntimeAgentStreamResponse>[0];

function runInput(runId: string, tools: RunInput["tools"]): RunInput {
  return {
    agentId: "intake-orchestrator",
    threadId: crypto.randomUUID(),
    runId,
    messages: [{ id: "user-1", role: "user", content: "Process the inbox." }],
    tools,
    context: [],
  } as RunInput;
}

const controlPlaneInvokeAgent = {
  name: "invoke_agent",
  description: "Invoke a project agent through the control plane",
  parameters: {
    type: "object",
    properties: {
      agent_id: { type: "string" },
      prompt: { type: "string" },
    },
    required: ["agent_id", "prompt"],
  },
};

describe("internal-agents/run-stream invoke_agent park (#1815)", () => {
  it("replaces the framework invoke_agent with the control-plane tool", () => {
    const runtimeAgent = createAgent({
      id: "intake-orchestrator",
      model: "hosted/invoke-merge-model",
      system: "Delegate classification.",
      tools: { invoke_agent: true },
      skills: false,
    });
    const configured = (runtimeAgent.config.tools as Record<string, unknown>).invoke_agent;
    assert(isFrameworkInvokeAgentTool(configured));

    const merged = buildMergedTools(
      runtimeAgent,
      runInput("run_invoke_merge_framework", [controlPlaneInvokeAgent]),
      new AgentRunSessionManager(),
    ) as Record<string, unknown>;

    assert(merged.invoke_agent !== configured, "the control-plane tool must replace the local one");
    assertEquals(isFrameworkInvokeAgentTool(merged.invoke_agent), false);
  });

  it("keeps a custom inline tool named invoke_agent", () => {
    const customInvokeAgent = tool({
      id: "invoke_agent",
      description: "Project-specific delegation",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => ({ ok: true }),
    });
    const runtimeAgent = createAgent({
      id: "intake-orchestrator",
      model: "hosted/invoke-merge-model",
      system: "Delegate classification.",
      tools: { invoke_agent: customInvokeAgent },
      skills: false,
    });

    const merged = buildMergedTools(
      runtimeAgent,
      runInput("run_invoke_merge_custom", [controlPlaneInvokeAgent]),
      new AgentRunSessionManager(),
    ) as Record<string, unknown>;

    assertEquals(merged.invoke_agent, customInvokeAgent);
  });

  it("waits for the control-plane invoke_agent result instead of starting another model call", async () => {
    const model = scriptedModel([
      {
        toolCalls: [{
          id: "toolu_invoke_1",
          name: "invoke_agent",
          input: { agent_id: "classifier", prompt: "Classify the message." },
        }],
      },
      { text: "Discarded follow-up step." },
    ], { modelId: "hosted/invoke-park-model", only: "stream" });
    const runtimeAgent = createAgent({
      id: "intake-orchestrator",
      model: "hosted/invoke-park-model",
      system: "Delegate classification.",
      tools: { invoke_agent: true },
      skills: false,
      maxSteps: 4,
      resolveModelTransport: () => Promise.resolve({ model }),
    });
    const sessionManager = new AgentRunSessionManager();
    const runId = "run_invoke_park";

    const response = await createRuntimeAgentStreamResponse(
      runInput(runId, [controlPlaneInvokeAgent]),
      runtimeAgent,
      { sessionManager },
    );
    const body = response.text();

    await waitFor(() => sessionManager.getRunStatus(runId) === "waiting", {
      message: "the run must wait for the control-plane invoke_agent result",
    });
    // Give a local tool and a follow-up model step every chance to run.
    await delay(50);
    assertEquals(
      model.callCount,
      1,
      "no model call may start after invoke_agent before the control plane parks the run",
    );

    // The control plane parks the run by cancelling the runtime session.
    assertEquals(sessionManager.cancelRun(runId), true);
    const text = await body;
    assertEquals(model.callCount, 1, "the parked run must not start another model call");
    assert(text.includes("toolu_invoke_1"), "the invoke_agent tool call must be streamed");
    assertEquals(text.includes("Discarded follow-up step."), false);
  });

  it("aborts the in-flight model call when the control plane cancels the run", async () => {
    const model = scriptedModel([
      { hangUntilAbort: true, parts: [{ type: "text-delta", text: "thinking" }] },
    ], { modelId: "hosted/invoke-cancel-model", only: "stream" });
    const runtimeAgent = createAgent({
      id: "intake-orchestrator",
      model: "hosted/invoke-cancel-model",
      system: "Think.",
      skills: false,
      maxSteps: 1,
      resolveModelTransport: () => Promise.resolve({ model }),
    });
    const sessionManager = new AgentRunSessionManager();
    const runId = "run_invoke_cancel";

    const response = await createRuntimeAgentStreamResponse(
      runInput(runId, []),
      runtimeAgent,
      { sessionManager },
    );
    const body = response.text();

    await waitFor(() => model.calls[0]?.abortSignal !== undefined, {
      message: "the provider call must be in flight before the cancel",
    });
    const providerSignal = model.calls[0]!.abortSignal!;
    assertEquals(providerSignal.aborted, false);

    assertEquals(sessionManager.cancelRun(runId), true);
    await waitFor(() => providerSignal.aborted, {
      message: "a control-plane cancel must abort the in-flight provider request",
    });
    await body;
    assertEquals(model.callCount, 1);
  });
});
