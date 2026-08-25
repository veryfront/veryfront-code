import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas";
import { type Tool, tool } from "#veryfront/tool";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import { agent } from "../index.ts";
import type { AgentConfig } from "../types.ts";
import { scriptedModel, type ScriptedTurn } from "./model-runtime.test-helpers.ts";
import type { RuntimeToolFilterConfig } from "./runtime-tool-config.ts";

// Asserting on message text would pin wording that no longer exists: the
// same-step gate and the allowed-tools policy check are both gone, so their
// literals can never appear and an `includes(...) === false` assertion passes
// no matter what the runtime does. These assert that no tool error surfaced at
// all, which catches any future blocking however it is phrased.

type RuntimeMode = "generate" | "stream";

type BatchRun = {
  /** Every surfaced tool error, joined; the transports report errors differently. */
  errorText: string;
  toolErrorCount: number;
  executions: Record<string, number>;
};

/**
 * Drive one scripted conversation through the requested transport. Both loops
 * enforce skill policy independently, so every case below runs through both.
 */
async function runBatch(options: {
  scenario: string;
  mode: RuntimeMode;
  steps: readonly ScriptedTurn[];
  loadSkillResult: () => Record<string, unknown>;
  probeToolIds: readonly string[];
}): Promise<BatchRun> {
  const { scenario, mode, steps, loadSkillResult, probeToolIds } = options;
  const suffix = `${scenario}-${mode}`;
  const loadSkillId = "load_skill";
  const executions: Record<string, number> = {};

  const tools: Record<string, Tool> = {
    [loadSkillId]: tool({
      id: loadSkillId,
      description: "Load a skill body",
      inputSchema: defineSchema((v) => v.object({ skillId: v.string() }))(),
      execute: () => loadSkillResult(),
    }),
  };
  for (const probeId of probeToolIds) {
    executions[probeId] = 0;
    tools[probeId] = tool({
      id: probeId,
      description: `Probe tool ${probeId}`,
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => {
        executions[probeId] = (executions[probeId] ?? 0) + 1;
        return { ok: true };
      },
    });
  }

  try {
    const assistant = agent(
      {
        id: `same-step-${suffix}`,
        model: `hosted/same-step-${suffix}`,
        system: "Use tools when needed.",
        skills: true,
        tools,
        maxSteps: 4,
        resolveModelTransport: () => ({
          model: scriptedModel(steps, { modelId: `hosted/same-step-${suffix}` }),
        }),
        __vfToolLoadingMode: "eager",
      } as AgentConfig & RuntimeToolFilterConfig,
    );

    if (mode === "generate") {
      const response = await assistant.generate({ input: "Load the skill and work" });
      const toolErrors = response.toolCalls
        .filter((call) => call.status === "error")
        .map((call) => call.error ?? "unknown error");
      return {
        errorText: toolErrors.join("\n"),
        toolErrorCount: toolErrors.length,
        executions,
      };
    }

    const body = await (await assistant.stream({ input: "Load the skill and work" }))
      .toDataStreamResponse().text();
    // `tool-output-error` is the stream's own event type for a failed tool
    // call, so it stays true regardless of how a future error is worded.
    return {
      errorText: body,
      toolErrorCount: body.split("tool-output-error").length - 1,
      executions,
    };
  } finally {
    for (const toolId of [loadSkillId, ...probeToolIds]) toolRegistry.delete(toolId);
  }
}

describe("src/agent/runtime same-step load_skill batches", () => {
  for (const mode of ["generate", "stream"] as const) {
    it(`executes every tool batched with load_skill (${mode})`, async () => {
      const run = await runBatch({
        scenario: "allowed",
        mode,
        probeToolIds: ["probe_a", "probe_b"],
        loadSkillResult: () => ({
          skillId: "batched",
          instructions: "# Batched",
          allowedTools: ["load_skill", "probe_a", "probe_b"],
          references: [],
          scripts: [],
        }),
        steps: [
          {
            toolCalls: [
              { id: `${mode}-load`, name: "load_skill", input: { skillId: "batched" } },
              { id: `${mode}-probe-a`, name: "probe_a", input: {} },
              { id: `${mode}-probe-b`, name: "probe_b", input: {} },
            ],
          },
          { text: "done" },
        ],
      });

      assertEquals(run.executions.probe_a, 1);
      assertEquals(run.executions.probe_b, 1);
      // No tool error at all: both probes ran and nothing blocked them.
      assertEquals(run.toolErrorCount, 0, `unexpected tool error: ${run.errorText}`);
    });

    it(`lets the rest of the batch run when load_skill fails (${mode})`, async () => {
      const run = await runBatch({
        scenario: "failing-load",
        mode,
        probeToolIds: ["probe_a"],
        loadSkillResult: () => {
          throw new Error("skill not found");
        },
        steps: [
          {
            toolCalls: [
              { id: `${mode}-load`, name: "load_skill", input: { skillId: "missing" } },
              { id: `${mode}-probe-a`, name: "probe_a", input: {} },
            ],
          },
          { text: "done" },
        ],
      });

      assertEquals(run.executions.probe_a, 1);
      // Exactly one error, the deliberate load_skill failure. A probe blocked by
      // a reintroduced gate would push this to two, whatever the message says.
      assertEquals(run.toolErrorCount, 1, `unexpected tool errors: ${run.errorText}`);
    });
  }
});
