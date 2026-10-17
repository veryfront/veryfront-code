import "#veryfront/schemas/_test-setup.ts";
import { AgentRuntime } from "#veryfront/agent/runtime/index.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "#veryfront/tool";
import { DurableRunHome } from "#veryfront/internal-agents/durable-run-home.ts";

const directory = Deno.args[0]!;
const home = await DurableRunHome.open({
  directory: `${directory}/continuation`,
  identity: {
    projectId: "11111111-1111-4111-8111-111111111111",
    canonicalRunId: "22222222-2222-4222-8222-222222222222",
    publicRunId: "run-proof",
    agentId: "proof-agent",
    threadId: "77777777-7777-4777-8777-777777777777",
    sourceHash: "a".repeat(64),
  },
});
const model = scriptedModel([
  { toolCalls: [{ id: "stable-effect", name: "inspect", input: {} }] },
  { text: "Complete" },
], { only: "stream" });
const runtime = new AgentRuntime("crash-proof", {
  model: "veryfront-cloud/openai/gpt-5.4",
  system: "Synthetic",
  skills: false,
  maxSteps: 2,
  tools: {
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
    if (boundary.runtimeContinuation?.nextStep !== 1) return;
    await home.append({ sequence: 1, value: boundary.runtimeContinuation });
    await Deno.stdout.write(new TextEncoder().encode("READY\n"));
    await new Promise<void>(() => {});
  },
});
await new Response(
  await runtime.stream([{
    id: "user",
    role: "user",
    parts: [{ type: "text", text: "Synthetic" }],
  }]),
).text();
