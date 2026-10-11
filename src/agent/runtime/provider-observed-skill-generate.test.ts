import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { createToolsFromHostDefinitions, type HostToolSet } from "#veryfront/tool";
import { markTrustedHostToolSet } from "#veryfront/tool/host-tool-provenance.ts";
import { createEphemeralAgentWithRuntimeOptions } from "../factory.ts";
import { createRuntimeLoadSkillTool } from "./load-skill-tool.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";

it("requires generate providers to observe a skill body before reading its reference", async () => {
  const hostTools = markTrustedHostToolSet(
    {
      load_skill: createRuntimeLoadSkillTool({
        context: {
          projectId: "project-1",
          authToken: "test-token",
          branchId: "branch-1",
        },
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
  );
  const runtimeTools = createToolsFromHostDefinitions(hostTools);
  assertEquals(typeof runtimeTools.load_skill?.execute, "function");

  const model = scriptedModel([
    {
      toolCalls: [
        { id: "load-body", name: "load_skill", input: { load: { skillId: "review" } } },
        {
          id: "same-batch-reference",
          name: "load_skill",
          input: { reference: { skillId: "review", file: "references/checklist.md" } },
        },
      ],
    },
    {
      toolCalls: [{
        id: "observed-reference",
        name: "load_skill",
        input: { reference: { skillId: "review", file: "references/checklist.md" } },
      }],
    },
    { text: "done" },
  ], {
    modelId: "anthropic/observed-skill-reference-generate",
    provider: "anthropic",
    only: "generate",
  });
  const assistant = createEphemeralAgentWithRuntimeOptions({
    id: "observed-skill-reference-generate-agent",
    model: "anthropic/observed-skill-reference-generate",
    system: "Load the review skill and read the checklist.",
    skills: false,
    tools: runtimeTools,
    maxSteps: 4,
    resolveModelTransport: () => ({ model }),
  }, { preserveToolCatalog: true });

  const response = await assistant.generate({ input: "Read the checklist." });
  const bodyResult = response.toolCalls.find((call) => call.id === "load-body");
  const sameBatchReferenceResult = response.toolCalls.find((call) =>
    call.id === "same-batch-reference"
  );
  const observedReferenceResult = response.toolCalls.find((call) =>
    call.id === "observed-reference"
  );

  assertEquals(model.callCount, 3);
  assertEquals(response.text, "done");
  assertEquals(bodyResult?.status, "completed");
  assertStringIncludes(JSON.stringify(bodyResult?.result), '"skillId":"review"');
  assertEquals(sameBatchReferenceResult?.status, "error");
  assertStringIncludes(
    sameBatchReferenceResult?.error ?? "",
    'Read the load_skill result for "review" before requesting reference files.',
  );
  assertEquals(
    JSON.stringify(sameBatchReferenceResult).includes("Detailed checklist content"),
    false,
  );
  assertEquals(observedReferenceResult?.status, "completed");
  assertStringIncludes(
    JSON.stringify(observedReferenceResult?.result),
    "Detailed checklist content",
  );
});
