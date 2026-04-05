import { getAgent } from "#veryfront/agent";
import { toolRegistry } from "#veryfront/tool";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import type { HandlerContext } from "../../types.ts";
import { ensureProjectDiscovery } from "./project-discovery.ts";
import { agentRegistry } from "#veryfront/agent/composition/composition.ts";
import { skillRegistry } from "#veryfront/skill/registry.ts";
import { stop as stopEsbuild } from "esbuild";

function createHandlerContext(
  projectDir: string,
  projectSlug: string,
  environment: "preview" | "production",
  releaseId?: string,
): HandlerContext {
  return {
    projectDir,
    projectSlug,
    releaseId,
    resolvedEnvironment: environment,
    requestContext: {
      slug: projectSlug,
      branch: "main",
      mode: environment,
      token: "",
    },
    adapter: createMockAdapter(),
    securityConfig: null,
    cspUserHeader: null,
    isLocalProject: false,
  } as HandlerContext;
}

async function writeAgentFile(
  ctx: HandlerContext,
  agentId: string,
  systemPrompt: string,
): Promise<void> {
  await ctx.adapter.fs.writeFile(
    `${ctx.projectDir}/agents/${agentId}.ts`,
    [
      'import { agent } from "veryfront/agent";',
      "",
      "export default agent({",
      `  id: "${agentId}",`,
      `  system: "${systemPrompt}",`,
      "});",
      "",
    ].join("\n"),
  );
}

describe(
  "server/handlers/request/api/project-discovery",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterAll(async () => {
      await stopEsbuild();
    });

    it("re-runs preview discovery after source changes", async () => {
      agentRegistry.clearAll();
      toolRegistry.clearAll();

      const ctx = createHandlerContext("/preview-project", "preview-project", "preview");
      const agentId = "preview-agent";

      await writeAgentFile(ctx, agentId, "FIRST");
      await ensureProjectDiscovery(ctx);

      const firstAgent = getAgent(agentId);
      assertExists(firstAgent);
      assertEquals(firstAgent.config.system, "FIRST");

      await writeAgentFile(ctx, agentId, "SECOND");
      await ensureProjectDiscovery(ctx);

      const updatedAgent = getAgent(agentId);
      assertExists(updatedAgent);
      assertEquals(updatedAgent.config.system, "SECOND");
    });

    it("keeps production discovery cached for the same release", async () => {
      agentRegistry.clearAll();
      toolRegistry.clearAll();

      const ctx = createHandlerContext(
        "/production-project",
        "production-project",
        "production",
        "release-123",
      );
      const agentId = "production-agent";

      await writeAgentFile(ctx, agentId, "FIRST");
      await ensureProjectDiscovery(ctx);

      const firstAgent = getAgent(agentId);
      assertExists(firstAgent);
      assertEquals(firstAgent.config.system, "FIRST");

      await writeAgentFile(ctx, agentId, "SECOND");
      await ensureProjectDiscovery(ctx);

      const cachedAgent = getAgent(agentId);
      assertExists(cachedAgent);
      assertEquals(cachedAgent.config.system, "FIRST");
    });

    it("uses cache-key context to isolate production discovery by release", async () => {
      agentRegistry.clearAll();
      toolRegistry.clearAll();
      skillRegistry.clearAll();

      const ctx = createHandlerContext(
        "/production-scope-project",
        "production-scope-project",
        "production",
        "release-stale",
      );
      const agentId = "production-scope-agent";

      await writeAgentFile(ctx, agentId, "FIRST");
      await runWithCacheKeyContext(
        { projectId: "proj-1", mode: "production", versionId: "release-1" },
        () => ensureProjectDiscovery(ctx),
      );

      const firstAgent = await runWithCacheKeyContext(
        { projectId: "proj-1", mode: "production", versionId: "release-1" },
        async () => getAgent(agentId),
      );
      assertExists(firstAgent);
      assertEquals(firstAgent.config.system, "FIRST");

      await writeAgentFile(ctx, agentId, "SECOND");
      await runWithCacheKeyContext(
        { projectId: "proj-1", mode: "production", versionId: "release-2" },
        () => ensureProjectDiscovery(ctx),
      );

      const updatedAgent = await runWithCacheKeyContext(
        { projectId: "proj-1", mode: "production", versionId: "release-2" },
        async () => getAgent(agentId),
      );
      assertExists(updatedAgent);
      assertEquals(updatedAgent.config.system, "SECOND");

      const originalReleaseAgent = await runWithCacheKeyContext(
        { projectId: "proj-1", mode: "production", versionId: "release-1" },
        async () => getAgent(agentId),
      );
      assertExists(originalReleaseAgent);
      assertEquals(originalReleaseAgent.config.system, "FIRST");
    });

    it("respects configured custom discovery paths for request-time discovery", async () => {
      agentRegistry.clearAll();
      toolRegistry.clearAll();
      skillRegistry.clearAll();

      const ctx = createHandlerContext("/custom-paths-project", "custom-paths-project", "preview");
      ctx.config = {
        ai: {
          tools: { discovery: { paths: ["tooling"] } },
          agents: { discovery: { paths: ["crew"] } },
          skills: { discovery: { paths: ["custom-skills"] } },
        },
      } as HandlerContext["config"];

      await ctx.adapter.fs.writeFile(
        `${ctx.projectDir}/tooling/get-weather.ts`,
        [
          'import { tool } from "veryfront/tool";',
          'import { z } from "zod";',
          "",
          "export default tool({",
          '  description: "Return a deterministic weather report",',
          "  inputSchema: z.object({ city: z.string() }),",
          '  execute: async ({ city }) => ({ city, forecast: "windy" }),',
          "});",
          "",
        ].join("\n"),
      );

      await ctx.adapter.fs.writeFile(
        `${ctx.projectDir}/crew/custom-assistant.ts`,
        [
          'import { agent } from "veryfront/agent";',
          "",
          "export default agent({",
          '  id: "custom-assistant",',
          '  system: "Custom discovery agent",',
          '  skills: ["writer-helper"],',
          "  tools: { getWeather: true },",
          "});",
          "",
        ].join("\n"),
      );

      await ctx.adapter.fs.writeFile(
        `${ctx.projectDir}/custom-skills/writer-helper/SKILL.md`,
        [
          "---",
          "name: writer-helper",
          "description: Custom skill path",
          "---",
          "Use custom skill discovery.",
          "",
        ].join("\n"),
      );

      await ensureProjectDiscovery(ctx);

      const discoveredAgent = getAgent("custom-assistant");
      assertExists(discoveredAgent);
      assertEquals(toolRegistry.has("getWeather"), true);
      assertExists(skillRegistry.get("writer-helper"));
    });

    it("keeps explicit tool ids available for request-time project-agent runs", async () => {
      agentRegistry.clearAll();
      toolRegistry.clearAll();
      skillRegistry.clearAll();

      const ctx = createHandlerContext(
        "/explicit-tool-id-project",
        "explicit-tool-id-project",
        "preview",
      );

      await ctx.adapter.fs.writeFile(
        `${ctx.projectDir}/tools/write-report.ts`,
        [
          'import { tool } from "veryfront/tool";',
          'import { z } from "zod";',
          "",
          "export default tool({",
          '  id: "write-report",',
          '  description: "Persist a markdown report",',
          "  inputSchema: z.object({ markdown: z.string() }),",
          "  execute: async ({ markdown }) => ({ ok: true, markdown }),",
          "});",
          "",
        ].join("\n"),
      );

      await ctx.adapter.fs.writeFile(
        `${ctx.projectDir}/agents/demo-agent.ts`,
        [
          'import { agent } from "veryfront/agent";',
          "",
          "export default agent({",
          '  id: "demo-agent",',
          '  system: "Use the write-report tool when asked.",',
          '  tools: { "write-report": true },',
          "});",
          "",
        ].join("\n"),
      );

      await ensureProjectDiscovery(ctx);

      const discoveredAgent = getAgent("demo-agent");
      assertExists(discoveredAgent);
      assertEquals(toolRegistry.has("write-report"), true);
      assertEquals(toolRegistry.has("writeReport"), false);
      assertEquals(discoveredAgent.config.tools, { "write-report": true });
    });

    it("keeps explicit generated-looking tool ids available for request-time project-agent runs", async () => {
      agentRegistry.clearAll();
      toolRegistry.clearAll();
      skillRegistry.clearAll();

      const ctx = createHandlerContext(
        "/explicit-generated-looking-tool-id-project",
        "explicit-generated-looking-tool-id-project",
        "preview",
      );

      await ctx.adapter.fs.writeFile(
        `${ctx.projectDir}/tools/write-report.ts`,
        [
          'import { tool } from "veryfront/tool";',
          'import { z } from "zod";',
          "",
          "export default tool({",
          '  id: "tool_2024_01",',
          '  description: "Persist a markdown report",',
          "  inputSchema: z.object({ markdown: z.string() }),",
          "  execute: async ({ markdown }) => ({ ok: true, markdown }),",
          "});",
          "",
        ].join("\n"),
      );

      await ctx.adapter.fs.writeFile(
        `${ctx.projectDir}/agents/demo-agent.ts`,
        [
          'import { agent } from "veryfront/agent";',
          "",
          "export default agent({",
          '  id: "demo-agent",',
          '  system: "Use the explicit tool id when asked.",',
          '  tools: { "tool_2024_01": true },',
          "});",
          "",
        ].join("\n"),
      );

      await ensureProjectDiscovery(ctx);

      const discoveredAgent = getAgent("demo-agent");
      assertExists(discoveredAgent);
      assertEquals(toolRegistry.has("tool_2024_01"), true);
      assertEquals(toolRegistry.has("writeReport"), false);
      assertEquals(discoveredAgent.config.tools, { "tool_2024_01": true });
    });

    it("keeps object-spread overridden tool ids available for request-time project-agent runs", async () => {
      agentRegistry.clearAll();
      toolRegistry.clearAll();
      skillRegistry.clearAll();

      const ctx = createHandlerContext(
        "/explicit-spread-tool-id-project",
        "explicit-spread-tool-id-project",
        "preview",
      );

      await ctx.adapter.fs.writeFile(
        `${ctx.projectDir}/tools/write-report.ts`,
        [
          'import { tool } from "veryfront/tool";',
          'import { z } from "zod";',
          "",
          "const generated = tool({",
          '  description: "Persist a markdown report",',
          "  inputSchema: z.object({ markdown: z.string() }),",
          "  execute: async ({ markdown }) => ({ ok: true, markdown }),",
          "});",
          "",
          'export default { ...generated, id: "my-tool" };',
          "",
        ].join("\n"),
      );

      await ctx.adapter.fs.writeFile(
        `${ctx.projectDir}/agents/demo-agent.ts`,
        [
          'import { agent } from "veryfront/agent";',
          "",
          "export default agent({",
          '  id: "demo-agent",',
          '  system: "Use the explicit tool id when asked.",',
          '  tools: { "my-tool": true },',
          "});",
          "",
        ].join("\n"),
      );

      await ensureProjectDiscovery(ctx);

      const discoveredAgent = getAgent("demo-agent");
      assertExists(discoveredAgent);
      assertEquals(toolRegistry.has("my-tool"), true);
      assertEquals(toolRegistry.has("writeReport"), false);
      assertEquals(discoveredAgent.config.tools, { "my-tool": true });
    });
  },
);
