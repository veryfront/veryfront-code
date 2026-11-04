import { runWithToolCallOccurrences } from "#veryfront/runtime/tool-call-occurrence.ts";
import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/skill/_test-setup.ts";
import { AgentRuntime } from "#veryfront/agent/runtime/index.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "#veryfront/tool";
import { markTrustedHostToolProvenance } from "#veryfront/tool/host-tool-provenance.ts";
import { createLoadSkillTool } from "#veryfront/skill/tools.ts";
import { registerSkill } from "#veryfront/skill/registry.ts";
import { createSkillTestAdapter } from "#veryfront/skill/testing.ts";
import { DurableRunHome } from "#veryfront/internal-agents/durable-run-home.ts";

const directory = Deno.args[0]!;
const startup = Deno.args[1] === "startup";
const home = await DurableRunHome.open({
  directory: `${directory}/post-tool`,
  identity: {
    projectId: "11111111-1111-4111-8111-111111111111",
    canonicalRunId: "22222222-2222-4222-8222-222222222222",
    publicRunId: "run-proof",
    agentId: "proof-agent",
    threadId: "77777777-7777-4777-8777-777777777777",
    sourceHash: "a".repeat(64),
  },
});
if (startup) {
  registerSkill("crash-plan", {
    id: "crash-plan",
    rootPath: "/skills/crash-plan",
    metadata: { name: "crash-plan", description: "Synthetic guidance" },
    fsAdapter: createSkillTestAdapter({ "/skills/crash-plan/SKILL.md": "# Crash guidance" }),
  });
}
const model = scriptedModel([
  { toolCalls: [{ id: "stable-effect", name: "inspect", input: {} }] },
  { text: "Complete" },
], { only: "stream" });
const runtime = new AgentRuntime("proof-agent", {
  model: "veryfront-cloud/openai/gpt-5.4",
  system: "Synthetic",
  maxSteps: 2,
  ...(startup ? { bootstrapSkill: "crash-plan", skills: ["crash-plan"] } : { skills: false }),
  tools: startup ? { load_skill: markTrustedHostToolProvenance(createLoadSkillTool()) } : {
    inspect: tool({
      id: "inspect",
      description: "Synthetic",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => {
        await Deno.writeTextFile(`${directory}/effects`, "one\n", { append: true });
        return { ok: true };
      },
    }),
  },
}, {
  resolveModelRuntime: () => model,
  persistRecoveryBoundary: async (boundary) => {
    if (
      !boundary.messages.some((message) =>
        message.parts.some((part) => part.type === "tool-result")
      )
    ) return;
    // Stop at the FIRST result publication, before the later pauseAtBoundary callback.
    await home.append({
      sequence: 1,
      value: { runtimeContinuation: boundary.runtimeContinuation ?? null },
    });
    await Deno.stdout.write(new TextEncoder().encode("READY\n"));
    await new Promise<void>(() => {});
  },
});
await new Response(
  await runWithToolCallOccurrences(() =>
    runtime.stream([{
      id: "user",
      role: "user",
      parts: [{ type: "text", text: "Synthetic" }],
    }])
  ),
).text();
