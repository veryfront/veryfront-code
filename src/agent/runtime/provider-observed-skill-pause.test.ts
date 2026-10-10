import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { createToolsFromHostDefinitions, type HostToolSet } from "#veryfront/tool";
import { markTrustedHostToolSet } from "#veryfront/tool/host-tool-provenance.ts";
import type { Message } from "../types.ts";
import { AgentRuntime } from "./index.ts";
import { createRuntimeLoadSkillTool } from "./load-skill-tool.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";

function createReviewSkillTools() {
  return createToolsFromHostDefinitions(markTrustedHostToolSet(
    {
      load_skill: createRuntimeLoadSkillTool({
        context: { projectId: "project-1", authToken: "test-token", branchId: "branch-1" },
        skillsDir: "/skills",
        projectSkillLoader: {
          listProjectSkillReferences: (_context, skillId) =>
            Promise.resolve(skillId === "review" ? ["references/checklist.md"] : []),
          loadProjectSkill: (_context, skillId) =>
            Promise.resolve(
              skillId === "review"
                ? {
                  instructions: "# Review\nUse the checklist.",
                  references: ["references/checklist.md"],
                }
                : null,
            ),
          loadProjectSkillReference: (_context, skillId, normalizedFile) =>
            Promise.resolve(
              skillId === "review" && normalizedFile === "references/checklist.md"
                ? "Detailed checklist content"
                : null,
            ),
        },
        builtinStore: {
          readSkill: () => Promise.resolve(null),
          readReferenceFile: () => Promise.resolve(null),
          listReferences: () => Promise.resolve([]),
        },
      }),
    } satisfies HostToolSet,
  ));
}

async function readReferenceAfterPause(
  editCheckpoint: (checkpoint: Record<string, unknown>) => void,
): Promise<{ status: string | undefined; error: string | undefined; result: string }> {
  const model = scriptedModel([
    {
      toolCalls: [{ id: "load-body", name: "load_skill", input: { load: { skillId: "review" } } }],
    },
    {
      toolCalls: [{
        id: "resumed-reference",
        name: "load_skill",
        input: { reference: { skillId: "review", file: "references/checklist.md" } },
      }],
    },
    { text: "done" },
  ], { modelId: "anthropic/observed-skill-pause", provider: "anthropic", only: "stream" });
  const config = {
    model: "anthropic/observed-skill-pause",
    system: "Load the review skill and read the checklist.",
    skills: false as const,
    maxSteps: 4,
    tools: createReviewSkillTools(),
    resolveModelTransport: () => ({ model }),
  };
  const messages: Message[] = [{
    id: "request",
    role: "user",
    parts: [{ type: "text", text: "Read the checklist." }],
  }];
  let saved: unknown;
  const paused = new AgentRuntime("observed-skill-pause", config, {
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
  assertEquals(model.callCount, 1);

  // The control plane stores the continuation as JSON, so in-memory provenance is lost.
  const checkpointJson = JSON.parse(JSON.stringify(saved)) as Record<string, unknown>;
  editCheckpoint(checkpointJson);
  const resumedCalls: { id: string; status?: string; error?: string; result?: unknown }[] = [];
  const resumed = new AgentRuntime("observed-skill-pause", config, {
    preserveToolCatalog: true,
    manualPause: { load: async () => checkpointJson, acknowledge: async () => false },
  });
  await new Response(
    await resumed.stream(messages, undefined, {
      onFinish: (response) => {
        resumedCalls.push(...response.toolCalls);
      },
    }),
  ).text();
  assertEquals(model.callCount, 3);
  const reference = resumedCalls.find((call) => call.id === "resumed-reference");
  return {
    status: reference?.status,
    error: reference?.error,
    result: JSON.stringify(reference?.result ?? null),
  };
}

it("lets a resumed run read a reference whose skill body the provider saw before the pause", async () => {
  const reference = await readReferenceAfterPause(() => {});
  assertEquals(reference.status, "completed");
  assertStringIncludes(reference.result, "Detailed checklist content");
});

it("keeps references gated when a checkpoint carries no body provenance", async () => {
  const reference = await readReferenceAfterPause((checkpoint) => {
    delete checkpoint.trustedSkillLoadResultIds;
  });
  assertEquals(reference.status, "error");
  assertStringIncludes(
    reference.error ?? "",
    'Read the load_skill result for "review" before requesting reference files.',
  );
  assertEquals(reference.result.includes("Detailed checklist content"), false);
});

it("does not restore body provenance for an ambiguous checkpoint result", async () => {
  const reference = await readReferenceAfterPause((checkpoint) => {
    const messages = checkpoint.messages as { id: string; role: string }[];
    const bodyResult = messages.find((message) => message.role === "tool");
    messages.push({ ...structuredClone(bodyResult!), id: "duplicated-body-result" });
  });
  assertEquals(reference.status, "error");
  assertEquals(reference.result.includes("Detailed checklist content"), false);
});
