import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import {
  createToolsFromHostDefinitions,
  type HostToolSet,
  type ToolExecutionContext,
} from "#veryfront/tool";
import { markTrustedHostToolProvenance } from "#veryfront/tool/host-tool-provenance.ts";
import { prepareHostedChildForkRuntimeStepMessages } from "../hosted/child-fork-step-message-preparation.ts";
import { createRuntimeLoadSkillTool } from "../runtime/load-skill-tool.ts";
import { scriptedModel } from "../runtime/model-runtime.test-helpers.ts";
import { getMessageSchema } from "../schemas/index.ts";
import { runFrameworkForkStep, startAgentRuntimeForkWithHostTools } from "./fork-runtime-stream.ts";

Deno.test("a hosted child loads its configured canonical skill before the first model call", async (t) => {
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
  await t.step("a prepared context without room for startup fails before inference", async () => {
    for (const resolveSystem of [undefined, () => "Context overhead. ".repeat(50_000)]) {
      const blockedModel = scriptedModel([{ text: "Must not infer" }], { only: "stream" });
      const blocked = startAgentRuntimeForkWithHostTools({
        ...input,
        createModelRuntimeResolver: () => () => blockedModel,
        buildInstructions: resolveSystem
          ? input.buildInstructions
          : () => "Context overhead. ".repeat(50_000),
        prepareStep: (step) =>
          prepareHostedChildForkRuntimeStepMessages({
            ...step,
            bootstrapSkill: skillId,
            ...(resolveSystem ? { resolveSystem } : {}),
          }),
      }).streamResult;
      Promise.resolve(blocked.steps).catch(() => {});
      Promise.resolve(blocked.totalUsage).catch(() => {});
      let failure: unknown;
      try {
        for await (const _part of blocked.fullStream) { /* Drain. */ }
      } catch (error) {
        failure = error;
      }
      assertEquals(failure instanceof Error, true);
      assertEquals(blockedModel.callCount, 0);
      assertEquals(loads, 1);
    }
  });
  await t.step("the compatibility wrapper applies startup or fails before inference", async () => {
    for (const enabled of [true, false]) {
      let prompt = "";
      const wrapperModel = scriptedModel([(options) => {
        prompt = JSON.stringify(options.prompt);
        return { text: "Done" };
      }], { only: "stream" });
      const result = await runFrameworkForkStep({
        apiUrl: input.apiUrl,
        authToken: input.authToken,
        projectId: input.projectId,
        model: wrapperModel.modelId ?? "test/child-bootstrap",
        resolveModelRuntime: () => wrapperModel,
        bootstrapSkill: skillId,
        messages: [{
          id: "fixture-user",
          role: "user",
          parts: [{ type: "text", text: "Process email" }],
        }],
        system: "Follow the child skill.",
        forkToolNames: enabled ? ["veryfront__load_skill"] : [],
        frameworkTools: createToolsFromHostDefinitions(
          enabled ? { veryfront__load_skill: loader } : {},
        ),
      });
      result.responsePromise.catch(() => {});
      let failure: unknown;
      let streamText = "";
      try {
        await result.stream.pipeTo(
          new WritableStream({
            write(chunk) {
              streamText += new TextDecoder().decode(chunk);
            },
          }),
        );
        if (enabled) await result.responsePromise;
      } catch (error) {
        failure = error;
      }
      if (enabled) {
        assertEquals(failure, undefined);
        assertStringIncludes(prompt, "Canonical child ingestion instructions");
        assertEquals(wrapperModel.callCount, 1);
      } else {
        assertStringIncludes(streamText, '"type":"error"');
        assertEquals(wrapperModel.callCount, 0);
      }
    }
  });
  await t.step(
    "a fresh fork reauthorizes serialized history with its own trusted load",
    async () => {
      const previousLoads = loads;
      let prompt = "";
      const freshModel = scriptedModel([(options) => {
        prompt = JSON.stringify(options.prompt);
        return { text: "Fresh result" };
      }], { only: "stream" });
      const fresh = startAgentRuntimeForkWithHostTools({
        ...input,
        initialMessages: structuredClone(steps[0]?.messages ?? []).map((message) =>
          getMessageSchema().parse(message)
        ),
        createModelRuntimeResolver: () => () => freshModel,
        prepareStep: (step) =>
          prepareHostedChildForkRuntimeStepMessages({ ...step, bootstrapSkill: skillId }),
      }).streamResult;
      Promise.resolve(fresh.steps).catch(() => {});
      Promise.resolve(fresh.totalUsage).catch(() => {});
      for await (const _part of fresh.fullStream) { /* Drain. */ }
      await fresh.steps;
      assertEquals(loads, previousLoads + 1);
      assertEquals(freshModel.callCount, 1);
      assertStringIncludes(prompt, "Canonical child ingestion instructions");
    },
  );
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
        return "# Canonical child instructions remain active\n" +
          "Workflow requirement. ".repeat(300);
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
    prepareStep: ({ messages, forkToolNames }: {
      messages: import("../schemas/index.ts").Message[];
      forkToolNames: readonly string[];
    }) =>
      prepareHostedChildForkRuntimeStepMessages({
        messages,
        forkToolNames,
        bootstrapSkill: skillId,
        buildInstructions: () => "Follow the child skill.",
      }),
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
