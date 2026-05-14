import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { resolve } from "node:path";
import { getMCPRegistry, registerPrompt, registerResource } from "#veryfront/mcp";
import { nodeAdapter } from "#veryfront/platform/adapters/node.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { registerWorkflow, workflowRegistry } from "#veryfront/workflow/registry.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { agent } from "./factory.ts";
import {
  createRuntimeAgentDefinitionFromAgent,
  describeProjectAgentRuntimeAgentIdCandidates,
  discoverProjectAgentRuntime,
  doesProjectAgentRuntimeAgentMatchSource,
  getProjectAgentRuntimeAgentIdCandidates,
  resolveSingleProjectAgentRuntimeAgentId,
} from "./project-agent-runtime.ts";
import { createRuntimeAgentFromMarkdownDefinition } from "./runtime/agent-markdown-adapter.ts";

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
    model: "openai/gpt-5.4",
    maxSteps: 7,
    system: () => "Help from code.",
  });
  const markdownAgent = createRuntimeAgentFromMarkdownDefinition({
    id: "writer",
    name: "Writer",
    description: "Markdown-defined agent",
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
    instructions: "Help from code.",
    model: "openai/gpt-5.4",
    maxSteps: 7,
  });
  assertEquals(await createRuntimeAgentDefinitionFromAgent(markdownAgent), {
    id: "writer",
    name: "Writer",
    description: "Markdown-defined agent",
    instructions: "Help from markdown.",
    model: "anthropic/claude-sonnet-4-5",
    maxSteps: 4,
  });
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

Deno.test("discoverProjectAgentRuntime discovers configured project agent paths", async () => {
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
});
