import { toolRegistryInternal } from "#veryfront/tool/registry.ts";
import { skillRegistryInternal } from "#veryfront/skill/registry.ts";
import { FakeTime } from "#std/testing/time";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { registerSkill } from "#veryfront/skill/registry.ts";
import { tool } from "#veryfront/tool";
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
  context?: Record<string, unknown>,
  mode: "generate" | "stream" = "generate",
  observeStreamBody?: (body: string) => void,
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
    async doStream(options: unknown) {
      observed = extractSystemPrompt(options);
      return { stream: createRuntimeStream([{ type: "finish", finishReason: "stop" }]) };
    },
  } as unknown as ModelRuntime;

  const assistant = agent({
    ...config,
    model: "hosted/call-context",
    resolveModelTransport: () => Promise.resolve({ model }),
  });

  if (mode === "stream") {
    const response = (await assistant.stream({
      input: "Where does this project live?",
      context,
    })).toDataStreamResponse();
    observeStreamBody?.(await response.text());
  } else {
    await assistant.generate({ input: "Where does this project live?", context });
  }

  return observed;
}

describe("agent/factory call context", () => {
  afterEach(() => {
    agentRegistry.clearAll();
    skillRegistryInternal.clearAll();
    toolRegistryInternal.clearAll();
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

  it("adds one authoritative UTC snapshot to scheduled runs", async () => {
    using _time = new FakeTime(new Date("2026-07-19T07:30:00.000Z"));
    const prompt = await captureFactorySystemPrompt({
      id: "scheduled-agent",
      system:
        "Create the daily report.\n\n<runtime_context>\ncurrent_date_utc: 2025-07-14\n</runtime_context>",
      skills: false,
    }, { scheduleId: "schedule-1" });

    assertEquals(prompt.includes("2025-07-14"), false);
    assertEquals(prompt.match(/<runtime_context>/g)?.length, 1);
    assertStringIncludes(prompt, "current_time_utc: 2026-07-19T07:30:00.000Z");
    assertStringIncludes(prompt, "current_date_utc: 2026-07-19");
    assertStringIncludes(prompt, "run_started_at_utc: 2026-07-19T07:30:00.000Z");
  });

  it("keeps browser display context without letting it replace server UTC", async () => {
    using _time = new FakeTime(new Date("2026-07-19T07:30:00.000Z"));
    let streamBody = "";
    const prompt = await captureFactorySystemPrompt(
      {
        id: "browser-agent",
        system: "Answer with the current date.",
        environmentContext:
          "<date_time>\nBrowser timezone: America/Los_Angeles\nBrowser date: 2025-07-14\n</date_time>",
        skills: false,
      },
      undefined,
      "stream",
      (body) => {
        streamBody = body;
      },
    );

    assertStringIncludes(prompt, "Browser timezone: America/Los_Angeles");
    assertStringIncludes(prompt, "current_date_utc: 2026-07-19");
    assertEquals(
      prompt.indexOf("<environment_context>") < prompt.indexOf("<runtime_context>"),
      true,
    );
    assertStringIncludes(streamBody, '"type":"data-veryfront.runtime_context"');
    assertStringIncludes(streamBody, '"runStartedAtUtc":"2026-07-19T07:30:00.000Z"');
  });

  it("preserves a plain agent's authored prompt before runtime context", async () => {
    const prompt = await captureFactorySystemPrompt({
      id: "plain-agent",
      system: "You are a helpful assistant.",
      skills: false,
    });

    assertEquals(prompt.startsWith("You are a helpful assistant.\n\n<runtime_context>"), true);
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
    assertStringIncludes(
      prompt,
      '- {"skillId":"support-triage","description":"Triage incoming support requests"}',
    );
    assertEquals(prompt.includes("create_file"), false);
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
      '- {"skillId":"support-triage","description":"Triage incoming support requests"}',
    );
  });
});
