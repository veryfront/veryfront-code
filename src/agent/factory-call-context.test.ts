import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { registerSkill, skillRegistry } from "#veryfront/skill/registry.ts";
import { tool, toolRegistry } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { agent } from "./index.ts";
import { agentRegistry } from "./composition/index.ts";
import type { AgentConfig } from "./types.ts";

function createRuntimeStream(parts: unknown[]) {
  return new ReadableStream<unknown>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
      }
      controller.close();
    },
  });
}

function extractSystemPrompt(options: unknown): string {
  const prompt = (options as { prompt?: Array<{ role?: string; content?: unknown }> }).prompt;
  if (!Array.isArray(prompt)) {
    return "";
  }

  return prompt
    .filter((entry) => entry?.role === "system" && typeof entry.content === "string")
    .map((entry) => entry.content as string)
    .join("\n");
}

/** Runs one generate() call through a stub provider and returns the system prompt it saw. */
async function captureFactorySystemPrompt(
  config: Omit<AgentConfig, "model" | "resolveModelTransport">,
): Promise<string> {
  let observed = "";
  const model: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/call-context",
    // deno-lint-ignore require-await
    async doGenerate(options: unknown) {
      observed = extractSystemPrompt(options);
      return {
        content: [{ type: "text", text: "done" }],
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
    },
    // deno-lint-ignore require-await
    async doStream() {
      return { stream: createRuntimeStream([{ type: "finish", finishReason: "stop" }]) };
    },
  } as unknown as ModelRuntime;

  const assistant = agent({
    ...config,
    model: "hosted/call-context",
    resolveModelTransport: () => Promise.resolve({ model }),
  });

  await assistant.generate({ input: "Where does this project live?" });

  return observed;
}

describe("agent/factory call context", () => {
  afterEach(() => {
    agentRegistry.clearAll();
    skillRegistry.clearAll();
    toolRegistry.clearAll();
  });

  it("includes project and environment context in the project-runtime path (issue #73)", async () => {
    const prompt = await captureFactorySystemPrompt({
      id: "custom-project-agent",
      system: "You are a custom project agent.",
      projectContext: { projectId: "project-1", branchId: "branch-9" },
      environmentContext: "<layout_context>\nVisible panels: [chat]\n</layout_context>",
    });

    assertStringIncludes(prompt, "You are a custom project agent.");
    assertStringIncludes(prompt, '<project_context>\nproject_reference: "project-1"');
    assertStringIncludes(prompt, 'branch_id: "branch-9"');
    assertStringIncludes(prompt, "<environment_context>");
    assertStringIncludes(prompt, "Visible panels: [chat]");
  });

  it("leaves a plain agent's authored prompt untouched", async () => {
    const prompt = await captureFactorySystemPrompt({
      id: "plain-agent",
      system: "You are a helpful assistant.",
      skills: false,
    });

    assertEquals(prompt, "You are a helpful assistant.");
  });

  it("renders skills through the shared runtime skills block", async () => {
    registerSkill("support-triage", {
      id: "support-triage",
      metadata: {
        name: "support-triage",
        description: "Triage incoming support requests",
        allowedTools: ["create_file"],
      },
      rootPath: "/test/skills/support-triage",
    });

    const prompt = await captureFactorySystemPrompt({
      id: "skill-agent",
      system: "You are a support agent.",
    });

    assertStringIncludes(prompt, "<available_skills>");
    assertStringIncludes(prompt, "- support-triage: Triage incoming support requests");
    assertEquals(prompt.includes("(tools: create_file)"), false);
    assertStringIncludes(prompt, "execute_skill_script: Call with");
  });

  it("preserves skill tool metadata when the direct factory selects that tool", async () => {
    registerSkill("support-triage", {
      id: "support-triage",
      metadata: {
        name: "support-triage",
        description: "Triage incoming support requests",
        allowedTools: ["create_file"],
      },
      rootPath: "/test/skills/support-triage",
    });

    const prompt = await captureFactorySystemPrompt({
      id: "skill-agent",
      system: "You are a support agent.",
      tools: {
        create_file: tool({
          id: "create_file",
          description: "Create a file",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({ ok: true }),
        }),
      },
    });

    assertStringIncludes(
      prompt,
      "- support-triage: Triage incoming support requests (tools: create_file)",
    );
  });
});
