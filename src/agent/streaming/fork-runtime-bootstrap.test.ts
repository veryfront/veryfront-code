import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import type { HostToolSet, ToolExecutionContext } from "#veryfront/tool";
import { markTrustedHostToolProvenance } from "#veryfront/tool/host-tool-provenance.ts";
import { createRuntimeLoadSkillTool } from "../runtime/load-skill-tool.ts";
import { scriptedModel } from "../runtime/model-runtime.test-helpers.ts";
import { startAgentRuntimeForkWithHostTools } from "./fork-runtime-stream.ts";

Deno.test("a hosted child loads its configured canonical skill before the first model call", async () => {
  const skillId = "ingestion-agent--ingest-message";
  let loads = 0;
  const loader = markTrustedHostToolProvenance(createRuntimeLoadSkillTool({
    context: { authToken: "fixture-token", availableSkillIds: [skillId] },
    skillsDir: "/skills",
    builtinSkillIds: [skillId],
    projectSkillLoader: {
      loadProjectSkill: async () => null,
      listProjectSkillReferences: async () => [],
      loadProjectSkillReference: async () => null,
    },
    builtinStore: {
      readSkill: async () => {
        loads++;
        return "# Canonical child ingestion instructions";
      },
      listReferences: async () => [],
      readReferenceFile: async () => null,
    },
  }));
  let firstPrompt = "";
  const model = scriptedModel([(options) => {
    firstPrompt = JSON.stringify(options.prompt);
    return { text: "Done" };
  }], { only: "stream" });
  const input = {
    apiUrl: "https://api.example.com",
    authToken: "test-token",
    projectId: "test-project",
    provider: model.provider ?? "test",
    forkModel: model.modelId ?? "test/child-bootstrap",
    bootstrapSkill: skillId,
    createModelRuntimeResolver: () => () => model,
    maxSteps: 1,
    prompt: "Process one synthetic email.",
    buildInstructions: () => "Follow the child skill.",
    forkTools: { veryfront__load_skill: loader },
  };
  const { streamResult } = startAgentRuntimeForkWithHostTools(input);
  Promise.resolve(streamResult.steps).catch(() => {});
  Promise.resolve(streamResult.totalUsage).catch(() => {});
  for await (const _part of streamResult.fullStream) { /* Drain actual runtime events. */ }
  const steps = await streamResult.steps;
  assertStringIncludes(firstPrompt, "Canonical child ingestion instructions");
  assertEquals(loads, 1);
  assertEquals(model.callCount, 1);
  assertEquals(steps[0]?.toolCalls[0]?.input, { load: { skillId } });
});

Deno.test("a child keeps actual bootstrap instructions across tool steps and continuation without loading again", async () => {
  const skillId = "ingestion-agent--ingest-message";
  let loads = 0;
  const loader = markTrustedHostToolProvenance(createRuntimeLoadSkillTool({
    context: { authToken: "fixture-token", availableSkillIds: [skillId] },
    skillsDir: "/skills",
    builtinSkillIds: [skillId],
    projectSkillLoader: {
      loadProjectSkill: async () => null,
      listProjectSkillReferences: async () => [],
      loadProjectSkillReference: async () => null,
    },
    builtinStore: {
      readSkill: async () => {
        loads++;
        return "# Canonical child instructions remain active";
      },
      listReferences: async () => [],
      readReferenceFile: async () => null,
    },
  }));
  const prompts: string[] = [];
  const activeSkills: (string | undefined)[] = [];
  const model = scriptedModel([
    (options) => {
      prompts.push(JSON.stringify(options.prompt));
      return { toolCalls: [{ id: "work-1", name: "lookup", input: {} }] };
    },
    (options) => {
      prompts.push(JSON.stringify(options.prompt));
      return { toolCalls: [{ id: "work-2", name: "lookup", input: {} }] };
    },
    (options) => {
      prompts.push(JSON.stringify(options.prompt));
      return { text: "First result" };
    },
    (options) => {
      prompts.push(JSON.stringify(options.prompt));
      return { toolCalls: [{ id: "work-3", name: "lookup", input: {} }] };
    },
    (options) => {
      prompts.push(JSON.stringify(options.prompt));
      return { text: "Resumed result" };
    },
  ], { only: "stream" });
  let continued = false;
  const input = {
    apiUrl: "https://api.example.com",
    authToken: "test-token",
    projectId: "test-project",
    provider: model.provider ?? "test",
    forkModel: model.modelId ?? "test/child-bootstrap",
    bootstrapSkill: skillId,
    createModelRuntimeResolver: () => () => model,
    maxSteps: 3,
    maxContinuationSteps: 2,
    prompt: "Process one email.",
    buildInstructions: () => "Follow the child skill.",
    onBeforeStop: () => {
      if (continued) return null;
      continued = true;
      return "Resume the remaining work.";
    },
    forkTools: {
      veryfront__load_skill: loader,
      lookup: {
        description: "Read fixture",
        inputSchemaJson: { type: "object" as const, properties: {} },
        execute: (_args: unknown, context?: ToolExecutionContext) => {
          activeSkills.push(context?.activeSkillId);
          return { found: true };
        },
      },
    },
  };
  const { streamResult } = startAgentRuntimeForkWithHostTools(input);
  Promise.resolve(streamResult.steps).catch(() => {});
  Promise.resolve(streamResult.totalUsage).catch(() => {});
  for await (const _part of streamResult.fullStream) { /* Drain actual runtime events. */ }
  const steps = await streamResult.steps;
  assertEquals(prompts.length, 5);
  for (const prompt of prompts) {
    assertStringIncludes(prompt, "Canonical child instructions remain active");
  }
  assertEquals(loads, 1);
  assertEquals(activeSkills, [skillId, skillId, skillId]);
  assertEquals(
    steps.flatMap((step) => step.toolCalls).filter((call) =>
      call.toolName === "veryfront__load_skill"
    ).length,
    1,
  );
  assertEquals(steps.at(-1)?.text, "Resumed result");
});

Deno.test("child startup fails before inference when its canonical framework loader is absent or unauthorized", async () => {
  const skillId = "ingestion-agent--ingest-message";
  const unauthorized = markTrustedHostToolProvenance(createRuntimeLoadSkillTool({
    context: { authToken: "fixture-token", availableSkillIds: [] },
    skillsDir: "/skills",
    builtinSkillIds: [],
    projectSkillLoader: {
      loadProjectSkill: async () => {
        throw new Error("Unauthorized skill must not be read");
      },
      listProjectSkillReferences: async () => [],
      loadProjectSkillReference: async () => null,
    },
    builtinStore: {
      readSkill: async () => null,
      listReferences: async () => [],
      readReferenceFile: async () => null,
    },
  }));
  const toolSets: HostToolSet[] = [{}, { veryfront__load_skill: unauthorized }];
  for (const forkTools of toolSets) {
    const model = scriptedModel([{ text: "Must not infer" }], { only: "stream" });
    const input = {
      apiUrl: "https://api.example.com",
      authToken: "test-token",
      projectId: "test-project",
      provider: model.provider ?? "test",
      forkModel: model.modelId ?? "test/child-bootstrap",
      bootstrapSkill: skillId,
      createModelRuntimeResolver: () => () => model,
      maxSteps: 1,
      prompt: "Process email.",
      buildInstructions: () => "Follow the child skill.",
      forkTools,
    };
    const { streamResult } = startAgentRuntimeForkWithHostTools(input);
    Promise.resolve(streamResult.steps).catch(() => {});
    Promise.resolve(streamResult.totalUsage).catch(() => {});
    let failure: unknown;
    try {
      for await (const _part of streamResult.fullStream) { /* Drain. */ }
    } catch (error) {
      failure = error;
    }
    assertEquals(failure instanceof Error, true);
    assertEquals(model.callCount, 0);
  }
});
