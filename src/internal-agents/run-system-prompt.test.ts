import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Agent } from "#veryfront/agent";
import {
  composeInternalAgentRunSystemPrompt,
  getInternalAgentStudioRunContext,
} from "./run-system-prompt.ts";
import type { RuntimeRunAgentInput } from "./schema.ts";

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

describe("internal-agents/run-system-prompt", () => {
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
  });

  describe("composeInternalAgentRunSystemPrompt", () => {
    it("appends project context, environment context, and tool inventory", async () => {
      const prompt = await composeInternalAgentRunSystemPrompt({
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

      assertStringIncludes(prompt, "You are Custom Agent.");
      assertStringIncludes(prompt, '<project_context>\nproject_reference: "project-1"');
      assertStringIncludes(prompt, "branch_id: main (no branch_id needed for file operations)");
      assertStringIncludes(prompt, "<environment_context>");
      assertStringIncludes(prompt, "Visible panels: [chat]");
      assertStringIncludes(prompt, "Current run tool inventory:");
      assertStringIncludes(prompt, "- create_file");
      assertStringIncludes(prompt, "- update_file");
    });

    it("prefers the sandbox project id and renders explicit branch ids", async () => {
      const prompt = await composeInternalAgentRunSystemPrompt({
        agent: createAgent(),
        runInput: createRunInput([
          createStudioContextItem({ projectId: "studio-project", branchId: "branch-9" }),
        ]),
        projectId: "sandbox-project",
        toolNames: [],
      });

      assertStringIncludes(prompt, 'project_reference: "sandbox-project"');
      assertStringIncludes(prompt, 'branch_id: "branch-9"');
    });

    it("includes the requested model in runtime info", async () => {
      const prompt = await composeInternalAgentRunSystemPrompt({
        agent: createAgent({ model: "openai/gpt-5.4-nano" }),
        runInput: createRunInput(),
        toolNames: [],
      });

      assertStringIncludes(prompt, '<runtime_info>\nmodel: "openai/gpt-5.4-nano"\n</runtime_info>');
    });

    it("resolves function-based system prompts before composing", async () => {
      const prompt = await composeInternalAgentRunSystemPrompt({
        agent: createAgent({
          system: () => Promise.resolve("Base instructions with skill manifest."),
        }),
        runInput: createRunInput(),
        toolNames: ["load_skill"],
      });

      assertStringIncludes(prompt, "Base instructions with skill manifest.");
      assertStringIncludes(prompt, "- load_skill");
    });

    it("omits project and environment blocks when the run has no context", async () => {
      const prompt = await composeInternalAgentRunSystemPrompt({
        agent: createAgent(),
        runInput: createRunInput(),
        toolNames: [],
      });

      assertEquals(prompt.includes("<project_context>"), false);
      assertEquals(prompt.includes("<environment_context>"), false);
      assertStringIncludes(prompt, "You are Custom Agent.");
      assertStringIncludes(prompt, "- none");
    });
  });
});
