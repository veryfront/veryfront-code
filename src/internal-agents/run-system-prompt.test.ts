import { toolRegistryInternal } from "#veryfront/tool/registry.ts";
import { skillRegistryInternal } from "#veryfront/skill/registry.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { type Agent, agent, type AgentSystem } from "#veryfront/agent";
import { flattenSystemInstructions } from "#veryfront/agent/runtime/tool-inventory.ts";
import { DEFAULT_RUNTIME_AGENT_CONTEXT_MARKER } from "#veryfront/agent/runtime/call-context.ts";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { registerSkill } from "#veryfront/skill/registry.ts";
import {
  composeInternalAgentRunSystemPrompt,
  getInternalAgentStudioRunContext,
} from "./run-system-prompt.ts";
import type { RuntimeRunAgentInput } from "./schema.ts";
import type { ModelRuntime } from "#veryfront/provider";

const ENVIRONMENT_CONTEXT =
  "<date_time>\nCurrent ISO date: 2026-07-22\n</date_time>\n\n<layout_context>\nVisible panels: [chat]\n</layout_context>";

function createAgent(config: Partial<Agent["config"]> = {}): Agent {
  return {
    id: "custom-agent",
    config: {
      system: "You are Custom Agent.",
      ...config,
    },
  } as Agent;
}

function createRunInput(
  context: unknown[] = [],
): RuntimeRunAgentInput {
  return {
    threadId: "3f1d8a58-4f65-4b0e-9a51-0a1c8b7f8f30",
    runId: "run_1",
    messages: [],
    tools: [],
    context,
  } as unknown as RuntimeRunAgentInput;
}

function createStudioContextItem(data: Record<string, unknown>): unknown {
  return { type: "json", title: "studio_context", data };
}

function systemText(system: AgentSystem): string {
  return typeof system === "string" ? system : flattenSystemInstructions(system);
}

async function composeInternalAgentRunSystemText(
  input: Parameters<typeof composeInternalAgentRunSystemPrompt>[0],
): Promise<string> {
  const system = await composeInternalAgentRunSystemPrompt(input);
  return systemText(system);
}

describe("internal-agents/run-system-prompt", () => {
  afterEach(() => {
    agentRegistry.clearAll();
    skillRegistryInternal.clearAll();
    toolRegistryInternal.clearAll();
  });

  describe("getInternalAgentStudioRunContext", () => {
    it("extracts environment context, project id, and branch id", () => {
      const result = getInternalAgentStudioRunContext(
        createRunInput([
          createStudioContextItem({
            environmentContext: ENVIRONMENT_CONTEXT,
            projectId: "project-1",
            branchId: null,
          }),
        ]).context,
      );

      assertEquals(result.environmentContext, ENVIRONMENT_CONTEXT);
      assertEquals(result.projectId, "project-1");
      assertEquals(result.branchId, null);
    });

    it("ignores non-studio and malformed context items", () => {
      const result = getInternalAgentStudioRunContext(
        createRunInput([
          { description: "classic ag-ui item", value: "ignored" },
          { type: "json", title: "veryfront_invocation_context", data: { root_run_id: "run_1" } },
          { type: "json", title: "studio_context", data: { environmentContext: "   " } },
        ]).context,
      );

      assertEquals(result, {});
    });

    it("trims values and drops whitespace-only branch ids", () => {
      const result = getInternalAgentStudioRunContext(
        createRunInput([
          createStudioContextItem({
            projectId: "  project-1  ",
            branchId: "   ",
          }),
        ]).context,
      );

      assertEquals(result, { projectId: "project-1" });
    });
  });

  describe("composeInternalAgentRunSystemPrompt", () => {
    it("preserves structured cache metadata while appending run context", async () => {
      const prompt = await composeInternalAgentRunSystemPrompt({
        agent: createAgent({
          system: [{
            role: "system",
            content: "Shared structured instructions.",
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
            },
          }, {
            role: "system",
            content: "Existing dynamic instructions.",
          }],
        }),
        runInput: createRunInput([
          createStudioContextItem({ projectId: "project-1", branchId: null }),
        ]),
        toolNames: ["read_file"],
      });

      assertEquals(Array.isArray(prompt), true);
      if (!Array.isArray(prompt)) {
        throw new Error("Expected structured internal agent system messages");
      }
      assertEquals(prompt[0], {
        role: "system",
        content: "Shared structured instructions.",
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
        },
      });
      assertEquals(prompt[1]?.content, "Existing dynamic instructions.");
      assertEquals(prompt.slice(1).every((message) => message.providerOptions === undefined), true);
      assertStringIncludes(prompt[2]?.content ?? "", 'project_reference: "project-1"');
      assertStringIncludes(prompt.at(-1)?.content ?? "", "Current run tool inventory:");
      assertStringIncludes(prompt.at(-1)?.content ?? "", "- read_file");
    });

    it("uses the effective runtime provider key for structured cache metadata", async () => {
      const prompt = await composeInternalAgentRunSystemPrompt({
        agent: createAgent({
          model: "bedrock/claude-sonnet",
          system: [{
            role: "system",
            content: "Shared structured instructions.",
            providerOptions: {
              "AWS-Anthropic": { cacheControl: { type: "ephemeral", ttl: "1h" } },
            },
          }],
        }),
        runInput: createRunInput(),
        toolNames: [],
        modelRuntime: { provider: "AWS-Anthropic" } as unknown as ModelRuntime,
      });

      assertEquals(prompt[0]?.providerOptions, {
        "AWS-Anthropic": { cacheControl: { type: "ephemeral", ttl: "1h" } },
      });
      assertEquals(
        Object.hasOwn(prompt[0]?.providerOptions ?? {}, "anthropic"),
        false,
      );
    });

    it("preserves structured runtime marker placement without duplicating the tail", async () => {
      const prompt = await composeInternalAgentRunSystemPrompt({
        agent: createAgent({
          system: [{
            role: "system",
            content:
              `Instructions before.\n\n${DEFAULT_RUNTIME_AGENT_CONTEXT_MARKER}\n\nInstructions after.`,
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
            },
          }],
        }),
        runInput: createRunInput([
          createStudioContextItem({ projectId: "project-1", branchId: null }),
        ]),
        toolNames: [],
      });

      assertEquals(prompt[0], {
        role: "system",
        content: "Instructions before.",
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
        },
      });
      assertEquals(systemText(prompt).includes(DEFAULT_RUNTIME_AGENT_CONTEXT_MARKER), false);
      assertStringIncludes(prompt[1]?.content ?? "", 'project_reference: "project-1"');
      assertEquals(prompt[2], {
        role: "system",
        content: "Instructions after.",
      });
      assertEquals(systemText(prompt).split("Instructions after.").length - 1, 1);
    });

    it("appends project context, environment context, and tool inventory", async () => {
      const prompt = await composeInternalAgentRunSystemText({
        agent: createAgent(),
        runInput: createRunInput([
          createStudioContextItem({
            environmentContext: ENVIRONMENT_CONTEXT,
            projectId: "project-1",
            branchId: null,
          }),
        ]),
        projectId: null,
        toolNames: ["create_file", "update_file"],
      });

      assertStringIncludes(systemText(prompt), "You are Custom Agent.");
      assertStringIncludes(systemText(prompt), '<project_context>\nproject_reference: "project-1"');
      assertStringIncludes(
        systemText(prompt),
        "branch_id: main (no branch_id needed for file operations)",
      );
      assertStringIncludes(systemText(prompt), "<environment_context>");
      assertStringIncludes(systemText(prompt), "Visible panels: [chat]");
      assertStringIncludes(systemText(prompt), "Current run tool inventory:");
      assertStringIncludes(systemText(prompt), "- create_file");
      assertStringIncludes(systemText(prompt), "- update_file");
    });

    it("prefers the sandbox project id and renders explicit branch ids", async () => {
      const prompt = await composeInternalAgentRunSystemText({
        agent: createAgent(),
        runInput: createRunInput([
          createStudioContextItem({ projectId: "studio-project", branchId: "branch-9" }),
        ]),
        projectId: "sandbox-project",
        toolNames: [],
      });

      assertStringIncludes(systemText(prompt), 'project_reference: "sandbox-project"');
      assertStringIncludes(systemText(prompt), 'branch_id: "branch-9"');
    });

    it("prefers a trusted main branch target over Studio context", async () => {
      const prompt = await composeInternalAgentRunSystemText({
        agent: createAgent(),
        runInput: createRunInput([
          createStudioContextItem({ projectId: "studio-project", branchId: "branch-9" }),
        ]),
        projectId: "sandbox-project",
        branchId: null,
        toolNames: [],
      });

      assertStringIncludes(
        systemText(prompt),
        "branch_id: main (no branch_id needed for file operations)",
      );
      assertEquals(systemText(prompt).includes('branch_id: "branch-9"'), false);
    });

    it("includes the requested model in runtime info", async () => {
      const prompt = await composeInternalAgentRunSystemText({
        agent: createAgent({ model: "openai/gpt-5.4-nano" }),
        runInput: createRunInput(),
        toolNames: [],
      });

      assertStringIncludes(
        systemText(prompt),
        '<runtime_info>\nmodel: "openai/gpt-5.4-nano"\n</runtime_info>',
      );
    });

    it("resolves function-based system prompts before composing", async () => {
      const prompt = await composeInternalAgentRunSystemText({
        agent: createAgent({
          system: () => Promise.resolve("Base instructions with skill manifest."),
        }),
        runInput: createRunInput(),
        toolNames: ["load_skill"],
      });

      assertStringIncludes(systemText(prompt), "Base instructions with skill manifest.");
      assertStringIncludes(systemText(prompt), "- load_skill");
    });

    it("preserves the factory-resolved default skill catalog", async () => {
      registerSkill("support-triage", {
        id: "support-triage",
        metadata: {
          name: "support-triage",
          description: "Triage incoming support requests",
        },
        rootPath: "/test/skills/support-triage",
      });
      const skillAgent = agent({
        id: "skill-agent",
        system: "You are a support agent.",
      });
      const wrappedSkillAgent = {
        ...skillAgent,
        config: { ...skillAgent.config },
      };

      const prompt = await composeInternalAgentRunSystemText({
        agent: wrappedSkillAgent,
        runInput: createRunInput(),
        toolNames: ["load_skill"],
      });

      assertStringIncludes(systemText(prompt), "<available_skills>");
      assertStringIncludes(
        systemText(prompt),
        '- {"skillId":"support-triage","description":"Triage incoming support requests"}',
      );
      assertEquals(
        systemText(prompt).includes("- support-triage: Triage incoming support requests"),
        false,
      );
    });

    it("emits the pinned project-runtime system prompt", async () => {
      const prompt = await composeInternalAgentRunSystemText({
        agent: createAgent({ model: "openai/gpt-5.4-nano" }),
        runInput: createRunInput([
          createStudioContextItem({
            environmentContext: "<date_time>\nCurrent ISO date: 2026-07-22\n</date_time>",
            projectId: "project-1",
            branchId: null,
          }),
        ]),
        projectId: null,
        toolNames: ["create_file", "update_file"],
      });

      assertEquals(
        systemText(prompt),
        'You are Custom Agent.\n\n<project_context>\nproject_reference: "project-1"\nbranch_id: main (no branch_id needed for file operations)\n\nUse the exact project_reference above for project/platform tools unless a tool result explicitly confirms a different active project.\n\nCRITICAL: Do NOT guess or invent project references. If a tool requires project_reference, use the value above.\n</project_context>\n\n<runtime_info>\nmodel: "openai/gpt-5.4-nano"\n</runtime_info>\n\n<environment_context>\n<date_time>\nCurrent ISO date: 2026-07-22\n</date_time>\n</environment_context>\n\nCurrent run tool inventory:\n\n- create_file\n- update_file\n\nOnly treat the tools listed above as actually available in this run.\nIf the list is "- none", say plainly that no tools are available.\nDo NOT infer tool availability from examples, skills, or the base prompt.',
      );
    });

    it("does not repeat a project context the base instructions already carry", async () => {
      const prompt = await composeInternalAgentRunSystemText({
        agent: createAgent({
          system:
            'You are Custom Agent.\n\n<project_context>\nproject_reference: "project-1"\n</project_context>',
        }),
        runInput: createRunInput(),
        projectId: "project-1",
        toolNames: [],
      });

      assertEquals(systemText(prompt).split("<project_context>").length - 1, 1);
    });

    it("omits project and environment blocks when the run has no context", async () => {
      const prompt = await composeInternalAgentRunSystemText({
        agent: createAgent(),
        runInput: createRunInput(),
        toolNames: [],
      });

      assertEquals(systemText(prompt).includes("<project_context>"), false);
      assertEquals(systemText(prompt).includes("<environment_context>"), false);
      assertStringIncludes(systemText(prompt), "You are Custom Agent.");
      assertStringIncludes(systemText(prompt), "- none");
    });
  });
});
