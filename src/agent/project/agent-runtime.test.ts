import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { resolve } from "node:path";
import { getMCPRegistry, registerPrompt, registerResource } from "#veryfront/mcp";
import { nodeAdapter } from "#veryfront/platform/adapters/node.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { registerWorkflow, workflowRegistry } from "#veryfront/workflow/registry.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { agent } from "../factory.ts";
import {
  createRuntimeAgentDefinitionFromAgent,
  describeProjectAgentRuntimeAgentIdCandidates,
  discoverProjectAgentRuntime,
  doesProjectAgentRuntimeAgentMatchSource,
  getProjectAgentRuntimeAgentIdCandidates,
  resolveSingleProjectAgentRuntimeAgentId,
  runWithProjectAgentRuntime,
} from "./agent-runtime.ts";
import { createRuntimeAgentFromMarkdownDefinition } from "../runtime/agent-markdown-adapter.ts";
import { getActiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import {
  intersectSourceIntegrationPolicies,
  normalizeSourceIntegrationPolicy,
} from "#veryfront/integrations/source-policy.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { registerSkill, skillRegistry } from "#veryfront/skill/registry.ts";
import { createLoadSkillTool } from "#veryfront/skill/tools.ts";
import { getEffectiveAgentSystem } from "../runtime/effective-agent-system.ts";
import { tool } from "#veryfront/tool";

async function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = Deno.makeTempDirSync();
  try {
    await fn(dir);
  } finally {
    await stopEsbuild();
    Deno.removeSync(dir, { recursive: true });
  }
}

Deno.test("project agent runtime resolves code and markdown agent candidates", async () => {
  const codeAgent = agent({
    id: "coder",
    name: "Coder",
    description: "Code-defined agent",
    avatarUrl: "https://cdn.example.com/agents/coder.svg",
    model: "openai/gpt-5.4",
    maxSteps: 7,
    system: () => "Help from code.",
    tools: {
      get_active_agent_run: true,
      get_agent_run_events: true,
    },
    providerTools: ["web_search"],
  });
  const markdownAgent = createRuntimeAgentFromMarkdownDefinition({
    id: "writer",
    name: "Writer",
    description: "Markdown-defined agent",
    avatarUrl: "https://cdn.example.com/agents/writer.svg",
    instructions: "Help from markdown.",
    model: "anthropic/claude-sonnet-4-5",
    maxSteps: 4,
  });

  const candidates = getProjectAgentRuntimeAgentIdCandidates({
    agents: new Map([
      [markdownAgent.id, markdownAgent],
      [codeAgent.id, codeAgent],
    ]),
  });

  assertEquals(candidates, {
    codeAgentIds: ["coder"],
    markdownAgentIds: ["writer"],
  });
  assertEquals(describeProjectAgentRuntimeAgentIdCandidates(candidates), "coder, writer");
  assertEquals(
    resolveSingleProjectAgentRuntimeAgentId({ candidates, source: "code" }),
    "coder",
  );
  assertEquals(
    resolveSingleProjectAgentRuntimeAgentId({ candidates, source: "markdown" }),
    "writer",
  );
  assertEquals(
    resolveSingleProjectAgentRuntimeAgentId({ candidates, source: "auto" }),
    null,
  );
  assertEquals(doesProjectAgentRuntimeAgentMatchSource(codeAgent, "code"), true);
  assertEquals(doesProjectAgentRuntimeAgentMatchSource(codeAgent, "markdown"), false);
  assertEquals(doesProjectAgentRuntimeAgentMatchSource(markdownAgent, "markdown"), true);

  assertEquals(await createRuntimeAgentDefinitionFromAgent(codeAgent), {
    id: "coder",
    name: "Coder",
    description: "Code-defined agent",
    avatarUrl: "https://cdn.example.com/agents/coder.svg",
    instructions: "Help from code.",
    model: "openai/gpt-5.4",
    maxSteps: 7,
    providerTools: ["web_search"],
    tools: [
      "execute_skill_script",
      "get_active_agent_run",
      "get_agent_run_events",
      "load_skill",
      "load_skill_reference",
    ],
  });
  assertEquals(await createRuntimeAgentDefinitionFromAgent(markdownAgent), {
    id: "writer",
    name: "Writer",
    description: "Markdown-defined agent",
    avatarUrl: "https://cdn.example.com/agents/writer.svg",
    instructions: "Help from markdown.",
    model: "anthropic/claude-sonnet-4-5",
    maxSteps: 4,
  });
});

Deno.test("project agent runtime keeps factory skill catalogs out of hosted instructions", async () => {
  registerSkill("incident-response", {
    id: "incident-response",
    metadata: { name: "incident-response", description: "Respond to incidents" },
    rootPath: "/test/skills/incident-response",
  });

  try {
    const codeAgent = agent({
      id: "incident-agent",
      system: "Handle incidents carefully.",
    });
    const effectiveSystem = getEffectiveAgentSystem(codeAgent);
    const localPrompt = typeof effectiveSystem === "function"
      ? await effectiveSystem()
      : effectiveSystem;

    assertStringIncludes(localPrompt, "## Available Skills");
    assertEquals(codeAgent.config.system, "Handle incidents carefully.");
    assertEquals(
      (await createRuntimeAgentDefinitionFromAgent(codeAgent)).instructions,
      "Handle incidents carefully.",
    );
  } finally {
    skillRegistry.clearAll();
  }
});

Deno.test("project agent runtime serializes scoped delegates and first-party MCP presets", async () => {
  const coordinator = agent({
    id: "coordinator",
    system: "Delegate bounded specialist work.",
    delegates: ["specialist"],
    tools: {
      get_file: true,
      lookup_job: tool({
        id: "lookup_job",
        description: "Lookup a job posting",
        inputSchema: defineSchema((v) => v.object({ id: v.string() }))(),
        execute: ({ id }) => ({ id }),
      }),
      skip_file: false,
    },
    mcpServers: [
      {
        kind: "veryfront-api",
        toolPolicy: { allow: ["get_file"] },
      },
    ],
  });

  const definition = await createRuntimeAgentDefinitionFromAgent(coordinator);

  assertEquals(definition.tools, [
    "agent_specialist",
    "execute_skill_script",
    "get_file",
    "load_skill",
    "load_skill_reference",
    "lookup_job",
  ]);
  assertEquals(definition.delegates, ["specialist"]);
  assertEquals(definition.mcpServers, [{
    kind: "veryfront-api",
    toolPolicy: { allow: ["get_file"] },
  }]);
});

Deno.test("project agent runtime rejects non-serializable HTTP MCP credentials", async () => {
  const privateAgent = agent({
    id: "private-agent",
    system: "Use the private MCP server.",
    mcpServers: [{
      id: "private-mcp",
      transport: { type: "http", url: "https://mcp.example.test" },
      auth: { type: "bearer", token: "must-not-cross-hosted-boundary" },
    }],
  });

  await assertRejects(
    () => createRuntimeAgentDefinitionFromAgent(privateAgent),
    Error,
    'HTTP MCP server "private-mcp" cannot be serialized into a hosted agent definition',
  );
});

Deno.test("project agent runtime preserves an explicitly empty MCP catalog", async () => {
  const isolated = agent({
    id: "isolated",
    system: "Use no remote MCP servers.",
    mcpServers: [],
  });

  assertEquals((await createRuntimeAgentDefinitionFromAgent(isolated)).mcpServers, []);
});

Deno.test("discoverProjectAgentRuntime clears stale runtime registries before rediscovery", async () => {
  await withTempDir(async (rootDir) => {
    registerResource("stale-resource", {
      id: "stale-resource",
      pattern: "stale://resource",
      description: "Stale resource",
      paramsSchema: defineSchema((v) => v.object({}))(),
      load: () => Promise.resolve({ ok: true }),
    });
    registerPrompt("stale-prompt", {
      id: "stale-prompt",
      description: "Stale prompt",
      getContent: () => Promise.resolve("stale"),
    });
    registerWorkflow({ id: "stale-workflow", steps: [] });

    await discoverProjectAgentRuntime({
      projectDir: rootDir,
      adapter: nodeAdapter,
    });

    assertEquals(getMCPRegistry().resources.has("stale-resource"), false);
    assertEquals(getMCPRegistry().prompts.has("stale-prompt"), false);
    assertEquals(workflowRegistry.has("stale-workflow"), false);
  });
});

Deno.test("project runtime discovers local skills without an explicit adapter", async () => {
  await withTempDir(async (rootDir) => {
    const skillDir = resolve(rootDir, "skills", "extract-submission");
    Deno.mkdirSync(skillDir, { recursive: true });
    Deno.writeTextFileSync(
      resolve(skillDir, "SKILL.md"),
      [
        "---",
        "name: extract-submission",
        "description: Extract one submission",
        "---",
        "",
        "Parse the staged attachment and preserve field provenance.",
        "",
      ].join("\n"),
    );

    const discovery = await discoverProjectAgentRuntime({ projectDir: rootDir });

    assertEquals([...discovery.skills.keys()], ["extract-submission"]);
    const loaded = await createLoadSkillTool().execute({
      skillId: "extract-submission",
    }) as { skillId: string; instructions: string };
    assertEquals(loaded.skillId, "extract-submission");
    assertStringIncludes(
      loaded.instructions,
      "Parse the staged attachment and preserve field provenance.",
    );
  });
});

Deno.test({
  name: "project runtime returns and explicitly applies its exact source integration restriction",
  fn: async () => {
    let observedPolicy: ReturnType<typeof getActiveSourceIntegrationPolicy>;
    const observeKey = "__vfObserveDiscoveredAgentSourcePolicy";
    Object.defineProperty(globalThis, observeKey, {
      configurable: true,
      value: () => {
        observedPolicy = getActiveSourceIntegrationPolicy();
      },
    });

    try {
      await withTempDir(async (rootDir) => {
        const agentsDir = resolve(rootDir, "agents");
        Deno.mkdirSync(agentsDir, { recursive: true });
        Deno.writeTextFileSync(
          resolve(agentsDir, "observer.ts"),
          [
            "const observe = (globalThis as Record<string, unknown>)",
            `  [${JSON.stringify(observeKey)}] as () => void;`,
            "export default {",
            '  id: "observer",',
            '  config: { id: "observer", model: "auto", system: "Observe." },',
            "  async generate() {",
            "    observe();",
            '    return { text: "ok", messages: [], toolCalls: [], status: "completed" };',
            "  },",
            '  async stream() { throw new Error("not used"); },',
            '  async respond() { throw new Error("not used"); },',
            '  getMemory() { throw new Error("not used"); },',
            '  async getMemoryStats() { return { totalMessages: 0, estimatedTokens: 0, type: "test" }; },',
            "  async clearMemory() {},",
            "};",
            "",
          ].join("\n"),
        );

        const config: VeryfrontConfig = {
          integrations: {
            allow: { gmail: { allowedTools: ["list_emails"] } },
          },
        };
        const discovery = await discoverProjectAgentRuntime({
          projectDir: rootDir,
          adapter: nodeAdapter,
          config,
        });

        const expectedPolicy = normalizeSourceIntegrationPolicy(config.integrations);
        assertEquals(discovery.sourceIntegrationPolicy, expectedPolicy);
        const discoveredAgent = discovery.agents.get("observer")!;
        const originalGenerate = discoveredAgent.generate;

        await runWithProjectAgentRuntime(
          discovery,
          () => discoveredAgent.generate({ input: "Observe policy." }),
        );
        assertEquals(observedPolicy, expectedPolicy);
        assertEquals(discoveredAgent.generate, originalGenerate);
      });
    } finally {
      delete (globalThis as Record<string, unknown>)[observeKey];
    }
  },
});

Deno.test({
  name: "project discovery cannot widen an immutable run policy while importing a reloaded source",
  fn: async () => {
    let observedPolicy: ReturnType<typeof getActiveSourceIntegrationPolicy>;
    const observeKey = "__vfObserveWorkflowDiscoveryPolicy";
    Object.defineProperty(globalThis, observeKey, {
      configurable: true,
      value: () => {
        observedPolicy = getActiveSourceIntegrationPolicy();
      },
    });

    try {
      await withTempDir(async (rootDir) => {
        const agentsDir = resolve(rootDir, "agents");
        Deno.mkdirSync(agentsDir, { recursive: true });
        Deno.writeTextFileSync(
          resolve(agentsDir, "observer.ts"),
          [
            "const observe = (globalThis as Record<string, unknown>)",
            `  [${JSON.stringify(observeKey)}] as () => void;`,
            "observe();",
            "export default {",
            '  id: "observer",',
            '  config: { id: "observer", model: "auto", system: "Observe." },',
            '  async generate() { throw new Error("not used"); },',
            '  async stream() { throw new Error("not used"); },',
            '  async respond() { throw new Error("not used"); },',
            '  getMemory() { throw new Error("not used"); },',
            '  async getMemoryStats() { return { totalMessages: 0, estimatedTokens: 0, type: "test" }; },',
            "  async clearMemory() {},",
            "};",
            "",
          ].join("\n"),
        );

        const persistedPolicy = normalizeSourceIntegrationPolicy({
          allow: { confluence: { allowedTools: ["get_page"] } },
        });
        const reloadedConfig: VeryfrontConfig = {
          integrations: {
            allow: { gmail: { allowedTools: ["list_emails"] } },
          },
        };
        const reloadedPolicy = normalizeSourceIntegrationPolicy(reloadedConfig.integrations);
        const expectedPolicy = intersectSourceIntegrationPolicies(
          persistedPolicy,
          reloadedPolicy,
        );

        const discovery = await discoverProjectAgentRuntime({
          projectDir: rootDir,
          adapter: nodeAdapter,
          config: reloadedConfig,
          sourceIntegrationPolicy: persistedPolicy,
        });

        assertEquals(observedPolicy, expectedPolicy);
        assertEquals(discovery.sourceIntegrationPolicy, expectedPolicy);
      });
    } finally {
      delete (globalThis as Record<string, unknown>)[observeKey];
    }
  },
});

async function assertMultiAgentProjectDiscoveryWithoutServiceEntrypoint(): Promise<void> {
  await withTempDir(async (rootDir) => {
    const agentsDir = resolve(rootDir, "agents");
    const toolsDir = resolve(rootDir, "tools");
    Deno.mkdirSync(agentsDir, { recursive: true });
    Deno.mkdirSync(toolsDir, { recursive: true });

    for (
      const [fileName, id, name] of [
        ["reviewer.ts", "reviewer", "Reviewer"],
        ["support.ts", "support", "Support"],
      ] as const
    ) {
      Deno.writeTextFileSync(
        resolve(agentsDir, fileName),
        [
          'import { agent } from "veryfront/agent";',
          "",
          "export default agent({",
          `  id: "${id}",`,
          `  name: "${name}",`,
          '  model: "openai/gpt-5.4",',
          `  system: "You are the ${name.toLowerCase()} agent.",`,
          "});",
          "",
        ].join("\n"),
      );
    }

    for (
      const [fileName, id] of [
        ["echo.ts", "echo"],
        ["lookup.ts", "lookup"],
      ] as const
    ) {
      Deno.writeTextFileSync(
        resolve(toolsDir, fileName),
        [
          'import { tool } from "veryfront/tool";',
          'import { defineSchema } from "veryfront/schemas";',
          "",
          "export default tool({",
          `  id: "${id}",`,
          `  description: "${id} a value",`,
          "  inputSchema: defineSchema((v) => v.object({ value: v.string() }))(),",
          "  execute: ({ value }) => ({ value }),",
          "});",
          "",
        ].join("\n"),
      );
    }

    assertEquals(await nodeAdapter.fs.exists(resolve(rootDir, "service.ts")), false);

    const result = await discoverProjectAgentRuntime({
      projectDir: rootDir,
      adapter: nodeAdapter,
    });

    assertEquals([...result.agents.keys()].sort(), ["reviewer", "support"]);
    assertEquals([...result.tools.keys()].sort(), ["echo", "lookup"]);
    assertEquals(getProjectAgentRuntimeAgentIdCandidates(result), {
      codeAgentIds: ["reviewer", "support"],
      markdownAgentIds: [],
    });
  });
}

Deno.test({
  name:
    "discoverProjectAgentRuntime supports configured paths and multi-agent projects without service.ts",
  // Code primitive discovery invokes the esbuild-backed transpiler, which starts
  // an esbuild child process. This matches the sanitizer policy in the other
  // discovery tests that import TypeScript project primitives.
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withTempDir(async (rootDir) => {
      const agentsDir = resolve(rootDir, "crew");
      const toolsDir = resolve(rootDir, "toolbox");
      Deno.mkdirSync(agentsDir, { recursive: true });
      Deno.mkdirSync(toolsDir, { recursive: true });
      Deno.writeTextFileSync(
        resolve(agentsDir, "support.md"),
        `---
name: Support
model: openai/gpt-5.4
---

Help from configured markdown.
`,
      );
      Deno.writeTextFileSync(
        resolve(toolsDir, "echo.ts"),
        [
          'import { tool } from "veryfront/tool";',
          'import { defineSchema } from "veryfront/schemas";',
          "",
          "export default tool({",
          '  id: "echo",',
          '  description: "Echo input",',
          "  inputSchema: defineSchema((v) => v.object({ text: v.string() }))(),",
          "  execute: ({ text }) => ({ text }),",
          "});",
          "",
        ].join("\n"),
      );
      Deno.writeTextFileSync(
        resolve(rootDir, "veryfront.config.ts"),
        [
          "export default {",
          "  ai: {",
          '    agents: { discovery: { paths: ["crew"] } },',
          '    tools: { discovery: { paths: ["toolbox"] } },',
          "  },",
          "};",
          "",
        ].join("\n"),
      );

      const result = await discoverProjectAgentRuntime({
        projectDir: rootDir,
        adapter: nodeAdapter,
      });

      assertEquals([...result.agents.keys()], ["support"]);
      assertEquals([...result.tools.keys()], ["echo"]);
      assertEquals(getProjectAgentRuntimeAgentIdCandidates(result), {
        codeAgentIds: [],
        markdownAgentIds: ["support"],
      });
    });

    await assertMultiAgentProjectDiscoveryWithoutServiceEntrypoint();
  },
});
