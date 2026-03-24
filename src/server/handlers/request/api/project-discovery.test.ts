import { getAgent } from "#veryfront/agent";
import { toolRegistry } from "#veryfront/tool";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "../../types.ts";
import { ensureProjectDiscovery } from "./project-discovery.ts";
import { agentRegistry } from "#veryfront/agent/composition/composition.ts";
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
  },
);
