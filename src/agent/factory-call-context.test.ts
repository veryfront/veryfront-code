import { toolRegistryInternal } from "#veryfront/tool/registry.ts";
import { skillRegistryInternal } from "#veryfront/skill/registry.ts";
import { FakeTime } from "#std/testing/time";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { registerModelProvider, runWithVeryfrontCloudContextAsync } from "#veryfront/provider";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { registerSkill } from "#veryfront/skill/registry.ts";
import { tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { agent } from "./index.ts";
import { agentRegistry } from "./composition/index.ts";
import { getEffectiveAgentSystem } from "./runtime/effective-agent-system.ts";
import { scriptedModel } from "./runtime/model-runtime.test-helpers.ts";
import type { AgentConfig, RuntimeStateRequest } from "./types.ts";

/** Runs one generate() call through a stub provider and returns the system prompt it saw. */
async function captureFactorySystemPrompt(
  config: Omit<AgentConfig, "model" | "resolveModelTransport">,
  context?: Record<string, unknown>,
  mode: "generate" | "stream" = "generate",
  observeStreamBody?: (body: string) => void,
): Promise<string> {
  const model = scriptedModel([{ text: "done" }], { modelId: "hosted/call-context" });

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

  return model.systemPrompts().at(-1) ?? "";
}

describe("agent/factory call context", () => {
  afterEach(() => {
    agentRegistry.clearAll();
    skillRegistryInternal.clearAll();
    toolRegistryInternal.clearAll();
  });

  it("preserves layered cache metadata for string system prompts", async () => {
    const assistant = agent({
      id: "layered-string-system",
      system: "Shared instructions.",
      skills: false,
      projectContext: { projectId: "project-1" },
      environmentContext: "Browser timezone: UTC",
    });

    const configuredSystem = getEffectiveAgentSystem(assistant);
    assertEquals(typeof configuredSystem, "function");
    if (typeof configuredSystem !== "function") {
      throw new Error("Expected the factory to configure a system resolver");
    }
    const system = await configuredSystem();

    assertEquals(Array.isArray(system), true);
    if (!Array.isArray(system)) {
      throw new Error("Expected layered system messages");
    }
    assertEquals(system[0], {
      role: "system",
      content: "Shared instructions.",
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    });
    assertStringIncludes(
      system[1]?.content ?? "",
      '<project_context>\nproject_reference: "project-1"',
    );
    assertStringIncludes(system[1]?.content ?? "", "<environment_context>");
    assertEquals(system[1]?.providerOptions, undefined);
  });

  it("preserves a custom Anthropic provider alias without adding a second breakpoint", async () => {
    const assistant = agent({
      id: "custom-anthropic-alias",
      model: "bedrock/claude-sonnet",
      system: [
        {
          role: "system",
          content: "Shared instructions.",
          providerOptions: {
            bedrock: { cacheControl: { type: "ephemeral", ttl: "1h" } },
          },
        },
        { role: "system", content: "Authored dynamic instructions." },
      ],
      skills: false,
    });

    const configuredSystem = getEffectiveAgentSystem(assistant);
    if (typeof configuredSystem !== "function") {
      throw new Error("Expected the factory to configure a system resolver");
    }
    const system = await configuredSystem();

    assertEquals(system, [
      {
        role: "system",
        content: "Shared instructions.",
        providerOptions: {
          bedrock: { cacheControl: { type: "ephemeral", ttl: "1h" } },
        },
      },
      { role: "system", content: "Authored dynamic instructions." },
    ]);
  });

  it("uses the resolved cloud provider key when the provider-aware key is omitted", async () => {
    const previousAnthropicApiKey = getEnv("ANTHROPIC_API_KEY");
    deleteEnv("ANTHROPIC_API_KEY");
    try {
      const assistant = agent({
        id: "resolved-cloud-provider-key",
        model: "anthropic/claude-sonnet-4-6",
        system: [
          {
            role: "system",
            content: "Shared instructions.",
            providerOptions: {
              "veryfront-cloud": { cacheControl: { type: "ephemeral", ttl: "1h" } },
            },
          },
          { role: "system", content: "Authored dynamic instructions." },
        ],
        skills: false,
      });

      const configuredSystem = getEffectiveAgentSystem(assistant);
      if (typeof configuredSystem !== "function") {
        throw new Error("Expected the factory to configure a system resolver");
      }
      const system = await runWithVeryfrontCloudContextAsync(
        { apiToken: "test-token", projectSlug: "test-project" },
        async () => await configuredSystem(),
      );

      assertEquals(system, [
        {
          role: "system",
          content: "Shared instructions.",
          providerOptions: {
            "veryfront-cloud": { cacheControl: { type: "ephemeral", ttl: "1h" } },
          },
        },
        { role: "system", content: "Authored dynamic instructions." },
      ]);
    } finally {
      if (previousAnthropicApiKey === undefined) deleteEnv("ANTHROPIC_API_KEY");
      else setEnv("ANTHROPIC_API_KEY", previousAnthropicApiKey);
    }
  });

  it("uses the effective runtime provider key for structured cache metadata", async () => {
    const runtime = scriptedModel([{ text: "done" }], {
      provider: "claude",
      modelId: "claude-sonnet",
    });
    const unregister = registerModelProvider("bedrock", () => runtime);

    try {
      const assistant = agent({
        id: "runtime-anthropic-provider-key",
        model: "bedrock/claude-sonnet",
        system: [
          {
            role: "system",
            content: "Shared instructions.",
            providerOptions: {
              claude: { cacheControl: { type: "ephemeral", ttl: "1h" } },
            },
          },
          { role: "system", content: "Authored dynamic instructions." },
        ],
        skills: false,
      });

      await assistant.generate({ input: "Hello" });

      const observedSystem = runtime.calls[0]?.prompt
        .filter((message) => message.role === "system");
      if (!Array.isArray(observedSystem)) {
        throw new Error("Expected the model runtime to receive system messages");
      }
      assertEquals(observedSystem.slice(0, 2), [
        {
          role: "system",
          content: "Shared instructions.",
          providerOptions: {
            claude: { cacheControl: { type: "ephemeral", ttl: "1h" } },
          },
        },
        { role: "system", content: "Authored dynamic instructions." },
      ]);
      assertEquals(observedSystem[2]?.providerOptions, undefined);
    } finally {
      unregister();
    }
  });

  it("keeps the runtime state resolver system field backward compatible", async () => {
    const prompt = await captureFactorySystemPrompt({
      id: "legacy-runtime-state-system",
      system: "Shared instructions.",
      skills: false,
      resolveRuntimeState: ({ system }) => {
        assertEquals(typeof system, "string");
        if (typeof system !== "string") {
          throw new Error("Expected the legacy runtime state system field to remain text");
        }
        return { system: system.replace("Shared", "Refreshed") };
      },
    });

    assertStringIncludes(prompt, "Refreshed instructions.");
  });

  it("allows runtime state resolvers to replace structured system metadata", async () => {
    let observedStructuredSystem: RuntimeStateRequest["structuredSystem"];
    const prompt = await captureFactorySystemPrompt({
      id: "structured-runtime-state-system",
      system: "Shared instructions.",
      skills: false,
      resolveRuntimeState: ({ system, structuredSystem }) => {
        assertEquals(typeof system, "string");
        observedStructuredSystem = structuredSystem;
        return {
          structuredSystem: structuredSystem?.map((message, index) =>
            index === 0
              ? { ...message, content: message.content.replace("Shared", "Refreshed") }
              : message
          ),
        };
      },
    });

    assertEquals(observedStructuredSystem?.[0]?.providerOptions, {
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
    assertStringIncludes(prompt, "Refreshed instructions.");
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

    const authoredTools = {
      create_file: tool({
        id: "create_file",
        description: "Create a file",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () => ({ ok: true }),
      }),
    };
    const assistant = agent({
      id: "skill-agent",
      system: "You are a support agent.",
      tools: authoredTools,
    });
    const toolNames = Object.keys(assistant.config.tools ?? {});

    assertEquals(
      toolNames.includes("create_file"),
      true,
      "the authored tool must survive skill-tool merging",
    );
    assertEquals(
      toolNames.includes("load_skill"),
      true,
      "an agent advertising a skill must still carry load_skill so the model can load it",
    );

    const prompt = await captureFactorySystemPrompt({
      id: "skill-agent-prompt",
      system: "You are a support agent.",
      tools: authoredTools,
    });

    assertStringIncludes(
      prompt,
      '- {"skillId":"support-triage","description":"Triage incoming support requests"}',
    );
  });
});
