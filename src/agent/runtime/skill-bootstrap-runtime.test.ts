import { createToolsFromHostDefinitions } from "#veryfront/tool/host-tools.ts";
import { traceHostTools } from "#veryfront/tool/tracing.ts";
import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/skill/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { defineSchema } from "#veryfront/schemas";
import { tool } from "#veryfront/tool";
import { agent } from "../index.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";
import { createRuntimeLoadSkillTool } from "./load-skill-tool.ts";
import { markTrustedHostToolProvenance } from "#veryfront/tool/host-tool-provenance.ts";
import { assertStringIncludes } from "#veryfront/testing/assert.ts";
import { clearMCPRegistry } from "#veryfront/mcp/registry.ts";
import { createLoadSkillTool } from "#veryfront/skill/tools.ts";
import { registerSkill, skillRegistryInternal } from "#veryfront/skill/registry.ts";
import { createSkillTestAdapter } from "#veryfront/skill/testing.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";

describe("startup skill and tool bootstrap", () => {
  it("startup supports the Code framework's flat-input skill loader", async () => {
    clearMCPRegistry();
    skillRegistryInternal.clearAll();
    registerSkill("code-plan", {
      id: "code-plan",
      rootPath: "/skills/code-plan",
      metadata: { name: "code-plan", description: "Plan guidance" },
      fsAdapter: createSkillTestAdapter({
        "/skills/code-plan/SKILL.md": "# Code planning guidance",
      }),
    });
    const model = scriptedModel([(options) => {
      assertStringIncludes(JSON.stringify(options.prompt), "Code planning guidance");
      return { text: "Ready" };
    }], { only: "generate" });
    const assistant = agent({
      id: "bootstrap-code-loader",
      system: "Help with the task.",
      model: model.modelId,
      bootstrapSkill: "code-plan",
      skills: ["code-plan"],
      tools: { load_skill: createLoadSkillTool() },
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
    });
    try {
      const response = await assistant.generate({ input: "Plan the task" });
      assertEquals(response.toolCalls?.[0]?.args, { skillId: "code-plan" });
      assertEquals(model.callCount, 1);
    } finally {
      skillRegistryInternal.clearAll();
    }
  });

  it("startup resolves an agent-owned skill short name to its canonical ID", async () => {
    clearMCPRegistry();
    skillRegistryInternal.clearAll();
    registerSkill("researcher--cite", {
      id: "researcher--cite",
      ownerAgentId: "researcher",
      shortName: "cite",
      rootPath: "/skills/researcher--cite",
      metadata: { name: "cite", description: "Citation guidance" },
      fsAdapter: createSkillTestAdapter({
        "/skills/researcher--cite/SKILL.md": "# Citation guidance",
      }),
    });
    const model = scriptedModel([(options) => {
      assertStringIncludes(JSON.stringify(options.prompt), "Citation guidance");
      return { text: "Ready" };
    }], { only: "generate" });
    const assistant = agent({
      id: "researcher",
      system: "Help with the task.",
      model: model.modelId,
      bootstrapSkill: "cite",
      skills: ["cite"],
      tools: { load_skill: createLoadSkillTool() },
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
    });
    try {
      const response = await assistant.generate({ input: "Cite the sources" });
      assertEquals(response.toolCalls?.[0]?.args, { skillId: "researcher--cite" });
      assertEquals(response.toolCalls?.[0]?.result, {
        skillId: "researcher--cite",
        instructions: "# Citation guidance",
        references: [],
        scripts: [],
      });
      assertEquals(model.callCount, 1);
    } finally {
      skillRegistryInternal.clearAll();
    }
  });

  it("startup passes the canonical skill ID to an operation-shaped loader for a short name", async () => {
    clearMCPRegistry();
    skillRegistryInternal.clearAll();
    registerSkill("researcher--cite", {
      id: "researcher--cite",
      ownerAgentId: "researcher",
      shortName: "cite",
      rootPath: "/skills/researcher--cite",
      metadata: { name: "cite", description: "Citation guidance" },
      fsAdapter: createSkillTestAdapter({
        "/skills/researcher--cite/SKILL.md": "# Citation guidance",
      }),
    });
    const loader = markTrustedHostToolProvenance(createRuntimeLoadSkillTool({
      context: { authToken: "fixture-token", availableSkillIds: ["researcher--cite"] },
      skillsDir: "/skills",
      builtinSkillIds: ["researcher--cite"],
      projectSkillLoader: {
        loadProjectSkill: async () => null,
        listProjectSkillReferences: async () => [],
        loadProjectSkillReference: async () => null,
      },
      builtinStore: {
        readSkill: async () => "# Canonical citation guidance",
        listReferences: async () => [],
        readReferenceFile: async () => null,
      },
    }));
    const model = scriptedModel([(options) => {
      assertStringIncludes(JSON.stringify(options.prompt), "Canonical citation guidance");
      return { text: "Ready" };
    }], { only: "generate" });
    const assistant = agent({
      id: "researcher",
      system: "Help with the task.",
      model: model.modelId,
      bootstrapSkill: "cite",
      skills: ["cite"],
      tools: createToolsFromHostDefinitions({ load_skill: loader }),
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
    });
    try {
      const response = await assistant.generate({ input: "Cite the sources" });
      assertEquals(response.toolCalls?.[0]?.args, { load: { skillId: "researcher--cite" } });
      assertEquals(model.callCount, 1);
    } finally {
      skillRegistryInternal.clearAll();
    }
  });

  for (const mode of ["generate", "stream"] as const) {
    it(`startup skill loads for a ${mode} model without tool calling`, async () => {
      clearMCPRegistry();
      skillRegistryInternal.clearAll();
      registerSkill("code-plan", {
        id: "code-plan",
        rootPath: "/skills/code-plan",
        metadata: { name: "code-plan", description: "Plan guidance" },
        fsAdapter: createSkillTestAdapter({
          "/skills/code-plan/SKILL.md": "# Code planning guidance",
        }),
      });
      const model = scriptedModel([(options) => {
        assertStringIncludes(JSON.stringify(options.prompt), "Code planning guidance");
        assertEquals(options.tools ?? [], []);
        return { text: "Ready" };
      }], { only: mode });
      Object.assign(model, {
        runtimeCapabilities: { ...model.runtimeCapabilities, toolCalling: false as const },
      });
      const assistant = agent({
        id: `bootstrap-text-only-${mode}`,
        system: "Help with the task.",
        model: model.modelId,
        bootstrapSkill: "code-plan",
        skills: ["code-plan"],
        tools: { load_skill: markTrustedHostToolProvenance(createLoadSkillTool()) },
        maxSteps: 1,
        resolveModelTransport: () => ({ model }),
      });
      try {
        if (mode === "generate") {
          const response = await assistant.generate({ input: "Plan the task" });
          assertEquals(response.toolCalls?.[0]?.args, { skillId: "code-plan" });
        } else {
          const response = await assistant.stream({ input: "Plan the task" });
          assertStringIncludes(await response.toDataStreamResponse().text(), "Ready");
        }
        assertEquals(model.callCount, 1);
      } finally {
        skillRegistryInternal.clearAll();
      }
    });
  }

  it("startup skill preparation does not open an unmatched streamed step", async () => {
    clearMCPRegistry();
    skillRegistryInternal.clearAll();
    registerSkill("code-plan", {
      id: "code-plan",
      rootPath: "/skills/code-plan",
      metadata: { name: "code-plan", description: "Plan guidance" },
      fsAdapter: createSkillTestAdapter({
        "/skills/code-plan/SKILL.md": "# Code planning guidance",
      }),
    });
    const model = scriptedModel([{ text: "Ready" }], { only: "stream" });
    const { AgentRuntime } = await import("./index.ts");
    const runtime = new AgentRuntime("bootstrap-stream-lifecycle", {
      system: "Help with the task.",
      model: model.modelId,
      bootstrapSkill: "code-plan",
      skills: ["code-plan"],
      tools: { load_skill: markTrustedHostToolProvenance(createLoadSkillTool()) },
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
    });
    try {
      const text = await new Response(
        await runtime.stream([{
          id: "request",
          role: "user",
          parts: [{ type: "text", text: "Plan the task" }],
        }]),
      ).text();
      const steps = text.split("\n").filter((line) => line.startsWith("data: "))
        .map((line) => JSON.parse(line.slice(6)))
        .filter((part) => part.type === "step-start" || part.type === "step-end")
        .map((part) => part.type);
      assertEquals(model.callCount, 1);
      assertEquals(steps, ["step-start", "step-end"]);
    } finally {
      skillRegistryInternal.clearAll();
    }
  });

  for (const mode of ["generate", "stream"] as const) {
    it(`startup skill loads guidance before the first ${mode} model call`, async () => {
      clearMCPRegistry();
      let reads = 0;
      const loader = markTrustedHostToolProvenance(createRuntimeLoadSkillTool({
        context: { authToken: "fixture-token", availableSkillIds: ["plan"] },
        skillsDir: "/skills",
        builtinSkillIds: ["plan"],
        projectSkillLoader: {
          loadProjectSkill: () => Promise.resolve(null),
          listProjectSkillReferences: () => Promise.resolve([]),
          loadProjectSkillReference: () => Promise.resolve(null),
        },
        builtinStore: {
          readSkill: () => {
            reads++;
            return Promise.resolve(
              "# Bootstrap guidance\n" + "x".repeat(8300) + "\nBOOTSTRAP_GUIDANCE_END",
            );
          },
          listReferences: () => Promise.resolve([]),
          readReferenceFile: () => Promise.resolve(null),
        },
      }));
      const model = scriptedModel([(options) => {
        assertEquals(reads, 1);
        assertStringIncludes(JSON.stringify(options.prompt), "Bootstrap guidance");
        assertStringIncludes(JSON.stringify(options.prompt), "BOOTSTRAP_GUIDANCE_END");
        return { text: "Ready" };
      }], { only: mode });
      const assistant = agent({
        id: "bootstrap-success",
        system: "Help with the task.",
        model: model.modelId,
        bootstrapSkill: "plan",
        toolLoading: "deferred",
        toolResultContext: { maxInlineBytes: 8192, previewBytes: 2048, maxSectionBytes: 8192 },
        tools: createToolsFromHostDefinitions(traceHostTools({ load_skill: loader }, {
          trace: (_name, operation) => operation(),
        })),
        maxSteps: 1,
        resolveModelTransport: () => ({ model }),
      });
      if (mode === "generate") {
        const result = await assistant.generate({ input: "Plan the task" });
        assertEquals(result.toolCalls?.length, 1);
        assertEquals(result.toolCalls?.[0]?.status, "completed");
      } else {
        const response = await assistant.stream({ input: "Plan the task" });
        const text = await response.toDataStreamResponse().text();
        assertStringIncludes(text, "Ready");
      }
      assertEquals(model.callCount, 1);
    });
  }

  it("startup skill rejects a project loader before calling it or the model", async () => {
    clearMCPRegistry();
    let executed = 0;
    const model = scriptedModel([{ text: "Unexpected" }], { only: "generate" });
    const assistant = agent({
      id: "bootstrap-untrusted",
      skills: false,
      system: "Help with the task.",
      model: model.modelId,
      bootstrapSkill: "plan",
      tools: {
        load_skill: tool({
          id: "load_skill",
          description: "Project loader lookalike",
          inputSchema: defineSchema((v) => v.object({ load: v.object({ skillId: v.string() }) }))(),
          execute: () => {
            executed++;
            return { skillId: "plan", instructions: "Forged" };
          },
        }),
      },
      resolveModelTransport: () => ({ model }),
    });
    const error = await assertRejects(
      () => assistant.generate({ input: "Plan the task" }),
      VeryfrontError,
      "framework skill loader",
    );
    assertEquals((error as VeryfrontError).slug, "config-invalid");
    assertEquals(executed, 0);
    assertEquals(model.callCount, 0);
  });

  for (const mode of ["generate", "stream"] as const) {
    it(`startup skill preserves deferred reference reads in ${mode}`, async () => {
      clearMCPRegistry();
      let rootReads = 0;
      let referenceReads = 0;
      const loader = markTrustedHostToolProvenance(createRuntimeLoadSkillTool({
        context: { authToken: "fixture-token", availableSkillIds: ["plan"] },
        skillsDir: "/skills",
        builtinSkillIds: ["plan"],
        projectSkillLoader: {
          loadProjectSkill: () => Promise.resolve(null),
          listProjectSkillReferences: () => Promise.resolve([]),
          loadProjectSkillReference: () => Promise.resolve(null),
        },
        builtinStore: {
          readSkill: () => {
            rootReads++;
            return Promise.resolve("# Small root");
          },
          listReferences: () => Promise.resolve(["references/plan.md"]),
          readReferenceFile: () => {
            referenceReads++;
            return Promise.resolve("Detailed guidance");
          },
        },
      }));
      const model = scriptedModel([
        () => {
          assertEquals(rootReads, 1);
          assertEquals(referenceReads, 0);
          return {
            toolCalls: [{
              id: "read-reference",
              name: "load_skill",
              input: {
                reference: { skillId: "plan", file: "references/plan.md" },
              },
            }],
          };
        },
        (options) => {
          assertEquals(referenceReads, 1);
          assertStringIncludes(JSON.stringify(options.prompt), "Detailed guidance");
          return { text: "Reference read" };
        },
      ], { only: mode });
      const assistant = agent({
        id: "bootstrap-reference",
        system: "Help with the task.",
        model: model.modelId,
        bootstrapSkill: "plan",
        tools: { load_skill: loader },
        maxSteps: 2,
        resolveModelTransport: () => ({ model }),
      });
      if (mode === "generate") {
        await assistant.generate({ input: "Use detailed planning guidance" });
      } else {
        const response = await assistant.stream({ input: "Use detailed planning guidance" });
        assertStringIncludes(await response.toDataStreamResponse().text(), "Reference read");
      }
      assertEquals(model.callCount, 2);
      assertEquals(rootReads, 1);
      assertEquals(referenceReads, 1);
    });
  }

  it("replacement tools ignore the configured bootstrap selection", async () => {
    const configured = tool({
      id: "configured",
      description: "Configured",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => "configured",
    });
    const model = scriptedModel([{ text: "Ready" }], { only: "generate" });
    const assistant = agent({
      id: "bootstrap-replacement",
      system: "Help",
      model: model.modelId,
      tools: { configured },
      bootstrapTools: ["configured"],
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
    });
    await assistant.generate({ input: "Go", tools: {} });
    assertEquals(model.callCount, 1);
  });

  it("initial pause resumes startup guidance before its first model call", async () => {
    clearMCPRegistry();
    skillRegistryInternal.clearAll();
    registerSkill("pause-plan", {
      id: "pause-plan",
      rootPath: "/skills/pause-plan",
      metadata: { name: "pause-plan", description: "Guidance" },
      fsAdapter: createSkillTestAdapter({
        "/skills/pause-plan/SKILL.md": "# Required resumed guidance",
      }),
    });
    const model = scriptedModel([(options) => {
      assertStringIncludes(JSON.stringify(options.prompt), "Required resumed guidance");
      return { text: "Ready" };
    }], { only: "stream" });
    const { AgentRuntime } = await import("./index.ts");
    const config = {
      system: "Help",
      model: model.modelId,
      bootstrapSkill: "pause-plan",
      skills: ["pause-plan"],
      tools: { load_skill: markTrustedHostToolProvenance(createLoadSkillTool()) },
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
    };
    let saved: unknown;
    const messages = [{
      id: "request",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Go" }],
    }];
    try {
      const paused = new AgentRuntime("bootstrap-paused", config, {
        manualPause: {
          load: async () => null,
          requested: async () => true,
          acknowledge: async (checkpoint) => {
            saved = checkpoint;
            return true;
          },
        },
      });
      await new Response(await paused.stream(messages)).text();
      assertEquals(model.callCount, 0);
      assertEquals(saved !== undefined, true);
      const resumed = new AgentRuntime("bootstrap-paused", config, {
        manualPause: { load: async () => saved, acknowledge: async () => false },
      });
      const body = await new Response(await resumed.stream(messages)).text();
      assertEquals(model.callCount, 1);
      assertStringIncludes(body, "Ready");
    } finally {
      skillRegistryInternal.clearAll();
    }
  });

  it("concurrent startup runs sharing one loader each receive the complete skill root", async () => {
    clearMCPRegistry();
    const both = Promise.withResolvers<void>();
    let loads = 0;
    const loader = markTrustedHostToolProvenance(createRuntimeLoadSkillTool({
      context: { authToken: "fixture-token", availableSkillIds: ["plan"] },
      skillsDir: "/skills",
      builtinSkillIds: ["plan"],
      projectSkillLoader: {
        loadProjectSkill: async () => {
          if (++loads >= 2) both.resolve();
          await both.promise;
          return null;
        },
        listProjectSkillReferences: async () => [],
        loadProjectSkillReference: async () => null,
      },
      builtinStore: {
        readSkill: async () => "# Complete concurrent startup guidance",
        listReferences: async () => [],
        readReferenceFile: async () => null,
      },
    }));
    const check = (options: { prompt: unknown }) => {
      assertStringIncludes(JSON.stringify(options.prompt), "Complete concurrent startup guidance");
      return { text: "Ready" };
    };
    const model = scriptedModel([check, check], { only: "generate" });
    const assistant = agent({
      id: "shared-bootstrap",
      model: model.modelId,
      system: "Help",
      bootstrapSkill: "plan",
      tools: createToolsFromHostDefinitions({ load_skill: loader }),
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
    });
    await Promise.all([
      assistant.generate({ input: "First" }),
      assistant.generate({ input: "Second" }),
    ]);
    assertEquals(model.callCount, 2);
  });

  for (const mode of ["generate", "stream"] as const) {
    it(`startup guidance loads for a text-only ${mode} model without exposing tools`, async () => {
      clearMCPRegistry();
      const loader = markTrustedHostToolProvenance(createRuntimeLoadSkillTool({
        context: { authToken: "fixture-token", availableSkillIds: ["plan"] },
        skillsDir: "/skills",
        builtinSkillIds: ["plan"],
        projectSkillLoader: {
          loadProjectSkill: async () => null,
          listProjectSkillReferences: async () => [],
          loadProjectSkillReference: async () => null,
        },
        builtinStore: {
          readSkill: async () => "# Text-only startup guidance",
          listReferences: async () => [],
          readReferenceFile: async () => null,
        },
      }));
      const model = scriptedModel([(options) => {
        assertStringIncludes(JSON.stringify(options.prompt), "Text-only startup guidance");
        assertEquals(Object.keys(options.tools ?? {}).length, 0);
        return { text: "Ready" };
      }], { only: mode });
      const assistant = agent({
        id: "text-only-startup",
        system: "Help",
        model: model.modelId,
        bootstrapSkill: "plan",
        tools: createToolsFromHostDefinitions({ load_skill: loader }),
        maxSteps: 1,
        resolveModelTransport: () => ({
          model: { ...model, runtimeCapabilities: { toolCalling: false } },
        }),
      });
      if (mode === "generate") await assistant.generate({ input: "Go" });
      else {assertStringIncludes(
          await (await assistant.stream({ input: "Go" })).toDataStreamResponse().text(),
          "Ready",
        );}
      assertEquals(model.callCount, 1);
    });
  }

  for (const mode of ["generate", "stream"] as const) {
    it(`configured bootstrap tools do not break a text-only ${mode} model`, async () => {
      clearMCPRegistry();
      const lookup = tool({
        id: "lookup",
        description: "Lookup",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => "value",
      });
      const model = scriptedModel([(options) => {
        assertEquals(Object.keys(options.tools ?? {}).length, 0);
        return { text: "Ready" };
      }], { only: mode });
      const assistant = agent({
        id: "text-bootstrap-tools",
        system: "Help",
        model: model.modelId,
        tools: { lookup },
        bootstrapTools: ["lookup"],
        maxSteps: 1,
        resolveModelTransport: () => ({
          model: { ...model, runtimeCapabilities: { toolCalling: false } },
        }),
      });
      if (mode === "generate") await assistant.generate({ input: "Go" });
      else {assertStringIncludes(
          await (await assistant.stream({ input: "Go" })).toDataStreamResponse().text(),
          "Ready",
        );}
      assertEquals(model.callCount, 1);
    });
  }

  for (const mode of ["generate", "stream"] as const) {
    it(`configured provider bootstrap tools stay authorized for a text-only ${mode} model`, async () => {
      clearMCPRegistry();
      const model = scriptedModel([(options) => {
        assertEquals(Object.keys(options.tools ?? {}).length, 0);
        return { text: "Ready" };
      }], { provider: "anthropic", modelId: "claude-sonnet-4-6", only: mode });
      const assistant = agent({
        id: "text-provider-bootstrap",
        system: "Help",
        model: "anthropic/claude-sonnet-4-6",
        skills: false,
        tools: {},
        providerTools: ["web_search"],
        bootstrapTools: ["web_search"],
        maxSteps: 1,
        resolveModelTransport: () => ({
          model: { ...model, runtimeCapabilities: { toolCalling: false } },
        }),
      });
      if (mode === "generate") await assistant.generate({ input: "Go" });
      else {assertStringIncludes(
          await (await assistant.stream({ input: "Go" })).toDataStreamResponse().text(),
          "Ready",
        );}
      assertEquals(model.callCount, 1);
    });
  }

  for (const mode of ["generate", "stream"] as const) {
    it(`a submitted form continuation does not reload the startup skill in ${mode}`, async () => {
      clearMCPRegistry();
      let reads = 0;
      const loader = markTrustedHostToolProvenance(createRuntimeLoadSkillTool({
        context: { authToken: "fixture-token", availableSkillIds: ["plan"] },
        skillsDir: "/skills",
        builtinSkillIds: ["plan"],
        projectSkillLoader: {
          loadProjectSkill: async () => null,
          listProjectSkillReferences: async () => [],
          loadProjectSkillReference: async () => null,
        },
        builtinStore: {
          readSkill: async () => {
            reads += 1;
            return "# Plan guidance";
          },
          listReferences: async () => [],
          readReferenceFile: async () => null,
        },
      }));
      const model = scriptedModel([{ text: "Ready" }], { only: mode });
      const assistant = agent({
        id: "form-continuation-startup",
        system: "Help",
        model: model.modelId,
        bootstrapSkill: "plan",
        tools: createToolsFromHostDefinitions({ load_skill: loader }),
        maxSteps: 1,
        resolveModelTransport: () => ({ model }),
      });
      const input = { input: "Continue", context: { hasSubmittedFormInputResult: true } };
      if (mode === "generate") await assistant.generate(input);
      else await (await assistant.stream(input)).toDataStreamResponse().text();
      assertEquals(reads, 0);
      assertEquals(model.callCount, 1);
    });
  }
});
