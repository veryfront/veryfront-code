import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/skill/_test-setup.ts";
import { getAgent } from "#veryfront/agent";
import { toolRegistry } from "#veryfront/tool";
import { toolRegistryInternal } from "#veryfront/tool/registry.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import type { HandlerContext } from "../../types.ts";
import {
  clearProjectDiscoveryCacheForProject,
  ensureProjectDiscovery,
} from "./project-discovery.ts";
import { agentRegistryInternal } from "#veryfront/agent/composition/composition.ts";
import { promptRegistry, promptRegistryInternal } from "#veryfront/prompt/registry.ts";
import { resourceRegistry, resourceRegistryInternal } from "#veryfront/resource/registry.ts";
import { skillRegistry, skillRegistryInternal } from "#veryfront/skill/registry.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";

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

function assertConfiguredSkillInfrastructure(
  tools: unknown,
): asserts tools is Record<string, unknown> {
  assertExists(tools);
  if (tools === true || typeof tools !== "object") {
    throw new Error("Expected a concrete agent tool map");
  }
  const toolMap = tools as Record<string, unknown>;
  assertEquals(typeof toolMap.load_skill, "object");
  assertEquals(typeof toolMap.load_skill_reference, "object");
  assertEquals(typeof toolMap.execute_skill_script, "object");
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

async function writeSkillFile(
  ctx: HandlerContext,
  skillId: string,
): Promise<void> {
  await ctx.adapter.fs.writeFile(
    `${ctx.projectDir}/skills/${skillId}/SKILL.md`,
    [
      "---",
      `name: ${skillId}`,
      `description: ${skillId} fixture`,
      "---",
      `Use the ${skillId} fixture.`,
      "",
    ].join("\n"),
  );
}

async function writeResourceFile(
  ctx: HandlerContext,
  resourceId: string,
): Promise<void> {
  await ctx.adapter.fs.writeFile(
    `${ctx.projectDir}/resources/${resourceId}.ts`,
    [
      'import { resource } from "veryfront/resource";',
      'import { defineSchema } from "veryfront/schemas";',
      "",
      "export default resource({",
      `  description: "${resourceId}",`,
      "  paramsSchema: defineSchema((v) => v.object({}))(),",
      `  load: () => ({ resource: "${resourceId}" }),`,
      "});",
      "",
    ].join("\n"),
  );
}

async function writePromptFile(
  ctx: HandlerContext,
  promptId: string,
): Promise<void> {
  await ctx.adapter.fs.writeFile(
    `${ctx.projectDir}/prompts/${promptId}.ts`,
    [
      'import { prompt } from "veryfront/prompt";',
      "",
      "export default prompt({",
      `  description: "${promptId}",`,
      `  content: "${promptId}",`,
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
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();

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

    it("removes stale resources and prompts when preview discovery commits", async () => {
      resourceRegistryInternal.clearAll();
      promptRegistryInternal.clearAll();

      const ctx = createHandlerContext(
        "/preview-primitives-project",
        "preview-primitives-project",
        "preview",
      );
      await writeResourceFile(ctx, "old-resource");
      await writePromptFile(ctx, "old-prompt");
      await ensureProjectDiscovery(ctx);

      assertExists(resourceRegistry.get("oldResource"));
      assertExists(promptRegistry.get("oldPrompt"));

      await ctx.adapter.fs.remove(`${ctx.projectDir}/resources/old-resource.ts`);
      await ctx.adapter.fs.remove(`${ctx.projectDir}/prompts/old-prompt.ts`);
      await writeResourceFile(ctx, "new-resource");
      await writePromptFile(ctx, "new-prompt");
      await ensureProjectDiscovery(ctx);

      assertEquals(resourceRegistry.get("oldResource"), undefined);
      assertEquals(promptRegistry.get("oldPrompt"), undefined);
      assertExists(resourceRegistry.get("newResource"));
      assertExists(promptRegistry.get("newPrompt"));
    });

    it("reuses unchanged preview primitive modules across requests", async () => {
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();
      skillRegistryInternal.clearAll();

      const ctx = createHandlerContext(
        "/preview-module-cache-project",
        "preview-module-cache-project",
        "preview",
      );
      const counterKey = "__veryfrontPreviewDiscoveryImportCount";
      const globals = globalThis as typeof globalThis & Record<string, unknown>;
      delete globals[counterKey];

      await ctx.adapter.fs.writeFile(
        `${ctx.projectDir}/tools/counter.ts`,
        [
          'import { defineSchema } from "veryfront/schemas";',
          'import { tool } from "veryfront/tool";',
          "",
          `const counterKey = "${counterKey}";`,
          "const globals = globalThis as typeof globalThis & Record<string, unknown>;",
          "globals[counterKey] = Number(globals[counterKey] ?? 0) + 1;",
          "",
          "export default tool({",
          '  id: "counter",',
          '  description: "Count module evaluations.",',
          "  inputSchema: defineSchema((v) => v.object({}))(),",
          "  execute: async () => ({ count: globals[counterKey] }),",
          "});",
          "",
        ].join("\n"),
      );

      try {
        await ensureProjectDiscovery(ctx);
        await ensureProjectDiscovery(ctx);

        assertEquals(globals[counterKey], 1);
      } finally {
        delete globals[counterKey];
      }
    });

    it("does not reuse API-backed modules across projects", async () => {
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();
      skillRegistryInternal.clearAll();

      const firstCtx = createHandlerContext("/runtime/first", "first-project", "preview");
      const secondCtx = createHandlerContext("/runtime/second", "second-project", "preview");
      firstCtx.projectId = "first-project-id";
      secondCtx.projectId = "second-project-id";
      firstCtx.config = { fs: { type: "veryfront-api" } } as HandlerContext["config"];
      secondCtx.config = { fs: { type: "veryfront-api" } } as HandlerContext["config"];

      const counterKey = "__veryfrontCrossProjectDiscoveryImportCount";
      const globals = globalThis as typeof globalThis & Record<string, unknown>;
      delete globals[counterKey];
      const toolSource = [
        'import { defineSchema } from "veryfront/schemas";',
        'import { tool } from "veryfront/tool";',
        "",
        `const counterKey = "${counterKey}";`,
        "const globals = globalThis as typeof globalThis & Record<string, unknown>;",
        "globals[counterKey] = Number(globals[counterKey] ?? 0) + 1;",
        "",
        "export default tool({",
        '  id: "counter",',
        '  description: "Count module evaluations.",',
        "  inputSchema: defineSchema((v) => v.object({}))(),",
        "  execute: async () => ({ count: globals[counterKey] }),",
        "});",
        "",
      ].join("\n");

      await firstCtx.adapter.fs.writeFile("tools/counter.ts", toolSource);
      await secondCtx.adapter.fs.writeFile("tools/counter.ts", toolSource);

      try {
        await ensureProjectDiscovery(firstCtx);
        await ensureProjectDiscovery(secondCtx);

        assertEquals(globals[counterKey], 2);
      } finally {
        delete globals[counterKey];
      }
    });

    it("invalidates extensionless import resolution after a source snapshot change", async () => {
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();
      skillRegistryInternal.clearAll();

      const ctx = createHandlerContext(
        "/runtime/resolution",
        "resolution-project",
        "preview",
      );
      ctx.projectId = "resolution-project-id";
      ctx.config = { fs: { type: "veryfront-api" } } as HandlerContext["config"];
      let sourceSnapshotVersion = 1;
      (
        ctx.adapter.fs as typeof ctx.adapter.fs & {
          getSourceSnapshotVersion: () => number;
        }
      ).getSourceSnapshotVersion = () => sourceSnapshotVersion;
      const resolvedConfigBase = `${Deno.cwd()}/tools/config`;

      await ctx.adapter.fs.writeFile(
        "tools/resolution.ts",
        [
          'import { tool } from "veryfront/tool";',
          'import { defineSchema } from "veryfront/schemas";',
          'import { description } from "./config";',
          "",
          "export default tool({",
          '  id: "resolution_tool",',
          "  description,",
          "  inputSchema: defineSchema((v) => v.object({}))(),",
          "  execute: async () => ({}),",
          "});",
          "",
        ].join("\n"),
      );
      await ctx.adapter.fs.writeFile(
        `${resolvedConfigBase}.tsx`,
        'export const description = "TSX candidate";\n',
      );

      const first = await ensureProjectDiscovery(ctx);
      assertEquals(first.tools.get("resolution_tool")?.description, "TSX candidate");

      await ctx.adapter.fs.writeFile(
        `${resolvedConfigBase}.ts`,
        'export const description = "TypeScript candidate";\n',
      );
      sourceSnapshotVersion++;

      const second = await ensureProjectDiscovery(ctx);
      assertEquals(second.tools.get("resolution_tool")?.description, "TypeScript candidate");
    });

    it("invalidates extensionless import resolution without snapshot versioning", async () => {
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();
      skillRegistryInternal.clearAll();

      const ctx = createHandlerContext(
        "/runtime/versionless-resolution",
        "versionless-resolution-project",
        "preview",
      );
      ctx.projectId = "versionless-resolution-project-id";
      ctx.config = { fs: { type: "veryfront-api" } } as HandlerContext["config"];
      const resolvedConfigBase = `${Deno.cwd()}/tools/versionless-config`;

      await ctx.adapter.fs.writeFile(
        "tools/versionless-resolution.ts",
        [
          'import { tool } from "veryfront/tool";',
          'import { defineSchema } from "veryfront/schemas";',
          'import { description } from "./versionless-config";',
          "",
          "export default tool({",
          '  id: "versionless_resolution_tool",',
          "  description,",
          "  inputSchema: defineSchema((v) => v.object({}))(),",
          "  execute: async () => ({}),",
          "});",
          "",
        ].join("\n"),
      );
      await ctx.adapter.fs.writeFile(
        `${resolvedConfigBase}.tsx`,
        'export const description = "TSX candidate";\n',
      );

      const first = await ensureProjectDiscovery(ctx);
      assertEquals(
        first.tools.get("versionless_resolution_tool")?.description,
        "TSX candidate",
      );

      await ctx.adapter.fs.writeFile(
        `${resolvedConfigBase}.ts`,
        'export const description = "TypeScript candidate";\n',
      );

      const second = await ensureProjectDiscovery(ctx);
      assertEquals(
        second.tools.get("versionless_resolution_tool")?.description,
        "TypeScript candidate",
      );
    });

    it("reuses preview discovery for one source snapshot generation", async () => {
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();

      const ctx = createHandlerContext(
        "/versioned-preview-project",
        "versioned-preview-project",
        "preview",
      );
      const agentId = "versioned-preview-agent";
      let sourceSnapshotVersion = 1;
      (
        ctx.adapter.fs as typeof ctx.adapter.fs & {
          getSourceSnapshotVersion: () => number;
        }
      ).getSourceSnapshotVersion = () => sourceSnapshotVersion;

      await writeAgentFile(ctx, agentId, "FIRST");
      await ensureProjectDiscovery(ctx);

      await writeAgentFile(ctx, agentId, "SECOND");
      await ensureProjectDiscovery(ctx);

      const cachedAgent = getAgent(agentId);
      assertExists(cachedAgent);
      assertEquals(cachedAgent.config.system, "FIRST");

      sourceSnapshotVersion++;
      await ensureProjectDiscovery(ctx);

      const updatedAgent = getAgent(agentId);
      assertExists(updatedAgent);
      assertEquals(updatedAgent.config.system, "SECOND");
    });

    it("contains hostile source-refresh failures and retries without a cache record", async () => {
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();

      const ctx = createHandlerContext(
        "/hostile-source-refresh-project",
        "hostile-source-refresh-project",
        "preview",
      );
      const hostileFailure = new Proxy(Object.create(null), {
        get() {
          throw new Error("hostile get trap escaped");
        },
        getPrototypeOf() {
          throw new Error("hostile prototype trap escaped");
        },
      });
      let refreshAttempts = 0;
      (
        ctx.adapter.fs as typeof ctx.adapter.fs & {
          ensureSourceSnapshotFresh: (reason?: string) => Promise<void>;
        }
      ).ensureSourceSnapshotFresh = async () => {
        refreshAttempts++;
        if (refreshAttempts === 1) throw hostileFailure;
      };

      const failure = await assertRejects(
        () => ensureProjectDiscovery(ctx),
        VeryfrontError,
        "Runtime discovery failed: Unknown error",
      );
      assertInstanceOf(failure, VeryfrontError);
      assertStrictEquals(failure.cause, hostileFailure);

      const recovered = await ensureProjectDiscovery(ctx);
      assertEquals(recovered.errors.length, 0);
      assertEquals(refreshAttempts, 2);
    });

    it("redacts source-version credentials, preserves the cause, and retries", async () => {
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();

      const ctx = createHandlerContext(
        "/credential-source-version-project",
        "credential-source-version-project",
        "preview",
      );
      const sourceFailure = new Error(
        "snapshot unavailable at https://user:basic-secret@example.test/source?access_token=query-secret",
      );
      let versionReads = 0;
      (
        ctx.adapter.fs as typeof ctx.adapter.fs & {
          getSourceSnapshotVersion: () => number;
        }
      ).getSourceSnapshotVersion = () => {
        versionReads++;
        if (versionReads === 1) throw sourceFailure;
        return 1;
      };

      const logEntries: LogEntry[] = [];
      __registerLogRecordEmitter((entry) => logEntries.push(entry));

      let failure: unknown;
      try {
        failure = await assertRejects(
          () => ensureProjectDiscovery(ctx),
          VeryfrontError,
          "Runtime discovery failed:",
        );
      } finally {
        __resetLogRecordEmitterForTests();
      }

      assertInstanceOf(failure, VeryfrontError);
      assertStrictEquals(failure.cause, sourceFailure);
      assertEquals(failure.message.includes("[REDACTED]"), true);
      assertEquals(failure.message.includes("basic-secret"), false);
      assertEquals(failure.message.includes("query-secret"), false);
      const serializedLogs = JSON.stringify(logEntries);
      assertEquals(serializedLogs.includes("[REDACTED]"), true);
      assertEquals(serializedLogs.includes("basic-secret"), false);
      assertEquals(serializedLogs.includes("query-secret"), false);

      const recovered = await ensureProjectDiscovery(ctx);
      assertEquals(recovered.errors.length, 0);
      assertEquals(versionReads, 2);
    });

    it("keeps a newer source generation cached when an older discovery fails", async () => {
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();

      const ctx = createHandlerContext(
        "/overlapping-preview-project",
        "overlapping-preview-project",
        "preview",
      );
      const agentId = "overlapping-preview-agent";
      let sourceSnapshotVersion = 1;
      (
        ctx.adapter.fs as typeof ctx.adapter.fs & {
          getSourceSnapshotVersion: () => number;
        }
      ).getSourceSnapshotVersion = () => sourceSnapshotVersion;

      await writeAgentFile(ctx, agentId, "FIRST");

      const staleDiscoveryPaused = Promise.withResolvers<void>();
      const resumeStaleDiscovery = Promise.withResolvers<void>();
      const originalExists = ctx.adapter.fs.exists.bind(ctx.adapter.fs);
      let failFirstSkillsRead = true;
      ctx.adapter.fs.exists = async (path: string) => {
        if (failFirstSkillsRead && path === `${ctx.projectDir}/skills`) {
          failFirstSkillsRead = false;
          staleDiscoveryPaused.resolve();
          await resumeStaleDiscovery.promise;
          throw new Error("old snapshot unavailable");
        }
        return originalExists(path);
      };

      const staleDiscovery = ensureProjectDiscovery(ctx);
      await staleDiscoveryPaused.promise;

      sourceSnapshotVersion++;
      const currentDiscovery = ensureProjectDiscovery(ctx);
      // Let the newer generation publish its cache record before the older
      // transaction is released and rejects.
      await new Promise((resolve) => setTimeout(resolve, 0));
      resumeStaleDiscovery.resolve();

      await assertRejects(
        () => staleDiscovery,
        Error,
        "old snapshot unavailable",
      );
      await currentDiscovery;

      await writeAgentFile(ctx, agentId, "SECOND");
      await ensureProjectDiscovery(ctx);

      const cachedAgent = getAgent(agentId);
      assertExists(cachedAgent);
      assertEquals(cachedAgent.config.system, "FIRST");
    });

    it("prevents queued discovery generations from publishing after project invalidation", async () => {
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();

      const ctx = createHandlerContext(
        "/queued-invalidation-project",
        "queued-invalidation-project",
        "preview",
      );
      ctx.projectId = "queued-invalidation-project-id";
      const agentId = "queued-invalidation-agent";
      let sourceSnapshotVersion = 1;
      (
        ctx.adapter.fs as typeof ctx.adapter.fs & {
          getSourceSnapshotVersion: () => number;
        }
      ).getSourceSnapshotVersion = () => sourceSnapshotVersion;
      await writeAgentFile(ctx, agentId, "FIRST");

      const firstDiscoveryPaused = Promise.withResolvers<void>();
      const resumeFirstDiscovery = Promise.withResolvers<void>();
      const originalExists = ctx.adapter.fs.exists.bind(ctx.adapter.fs);
      let skillDirectoryReads = 0;
      ctx.adapter.fs.exists = async (path: string) => {
        if (path === `${ctx.projectDir}/skills`) {
          skillDirectoryReads++;
          if (skillDirectoryReads === 1) {
            firstDiscoveryPaused.resolve();
            await resumeFirstDiscovery.promise;
          }
        }
        return await originalExists(path);
      };

      const registryScope = {
        projectId: ctx.projectId,
        mode: "preview" as const,
        versionId: "source-generation",
      };
      const first = runWithCacheKeyContext(
        registryScope,
        () => ensureProjectDiscovery(ctx),
      );
      await firstDiscoveryPaused.promise;

      sourceSnapshotVersion++;
      await writeAgentFile(ctx, agentId, "SECOND");
      const queued = runWithCacheKeyContext(
        registryScope,
        () => ensureProjectDiscovery(ctx),
      );
      // Give the replacement generation time to enqueue behind the paused
      // transaction before authoritative project cleanup retires the scope.
      await new Promise((resolve) => setTimeout(resolve, 0));

      const firstRejection = assertRejects(
        () => first,
        Error,
        "invalidated",
      );
      const queuedRejection = assertRejects(
        () => queued,
        Error,
        "invalidated while waiting",
      );
      clearProjectDiscoveryCacheForProject(ctx.projectId);
      resumeFirstDiscovery.resolve();
      await Promise.all([firstRejection, queuedRejection]);

      assertEquals(skillDirectoryReads, 1);
      await runWithCacheKeyContext(registryScope, async () => {
        assertEquals(getAgent(agentId), undefined);
      });

      sourceSnapshotVersion++;
      await writeAgentFile(ctx, agentId, "THIRD");
      await runWithCacheKeyContext(
        registryScope,
        () => ensureProjectDiscovery(ctx),
      );
      await runWithCacheKeyContext(registryScope, async () => {
        assertEquals(getAgent(agentId)?.config.system, "THIRD");
      });
      assertEquals(skillDirectoryReads, 2);
    });

    it("keeps production discovery cached for the same release", async () => {
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();

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

    it("invalidates fallback discovery by canonical project id", async () => {
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();

      const ctx = createHandlerContext(
        "/project-id-invalidation",
        "project-id-invalidation-slug",
        "production",
        "release-123",
      );
      ctx.projectId = "project-id-invalidation-id";
      const agentId = "project-id-invalidation-agent";

      await writeAgentFile(ctx, agentId, "FIRST");
      await ensureProjectDiscovery(ctx);

      await writeAgentFile(ctx, agentId, "SECOND");
      await ensureProjectDiscovery(ctx);

      const cachedAgent = getAgent(agentId);
      assertExists(cachedAgent);
      assertEquals(cachedAgent.config.system, "FIRST");

      clearProjectDiscoveryCacheForProject(ctx.projectId);
      await ensureProjectDiscovery(ctx);

      const updatedAgent = getAgent(agentId);
      assertExists(updatedAgent);
      assertEquals(updatedAgent.config.system, "SECOND");
    });

    it("invalidates encoded request-scope discovery by raw project id", async () => {
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();

      const ctx = createHandlerContext(
        "/encoded-project-id-invalidation",
        "encoded-project-id-invalidation-slug",
        "production",
        "release-encoded",
      );
      ctx.projectId = "project:id%with-delimiters";
      const agentId = "encoded-project-id-invalidation-agent";
      const requestOptions = {
        projectSlug: ctx.projectSlug!,
        projectId: ctx.projectId,
        token: "encoded-token",
        productionMode: true,
        releaseId: ctx.releaseId,
      };

      await writeAgentFile(ctx, agentId, "FIRST");
      await runWithRequestContext(requestOptions, () => ensureProjectDiscovery(ctx));

      await writeAgentFile(ctx, agentId, "SECOND");
      await runWithRequestContext(requestOptions, () => ensureProjectDiscovery(ctx));
      await runWithRequestContext(requestOptions, async () => {
        assertEquals(getAgent(agentId)?.config.system, "FIRST");
      });

      clearProjectDiscoveryCacheForProject(ctx.projectId);
      await runWithRequestContext(requestOptions, () => ensureProjectDiscovery(ctx));

      await runWithRequestContext(requestOptions, async () => {
        assertEquals(getAgent(agentId)?.config.system, "SECOND");
      });
    });

    it("does not cache completed production discovery without a release id", async () => {
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();

      const ctx = createHandlerContext(
        "/production-missing-release-project",
        "production-missing-release-project",
        "production",
      );
      const agentId = "production-missing-release-agent";

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

    it("keeps the live skill registry available until mutable rediscovery commits", async () => {
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();
      skillRegistryInternal.clearAll();

      const ctx = createHandlerContext(
        "/atomic-discovery-project",
        "atomic-discovery-project",
        "production",
      );
      ctx.projectId = "atomic-discovery-project-id";
      const requestContext = {
        projectSlug: ctx.projectSlug!,
        projectId: ctx.projectId,
        token: "<TOKEN>",
        productionMode: true,
        releaseId: null,
        environmentName: "Development",
      };

      await writeSkillFile(ctx, "old-skill");
      await runWithRequestContext(requestContext, () => ensureProjectDiscovery(ctx));

      await ctx.adapter.fs.remove(`${ctx.projectDir}/skills/old-skill`, { recursive: true });
      await writeSkillFile(ctx, "new-skill");

      const discoveryPaused = Promise.withResolvers<void>();
      const resumeDiscovery = Promise.withResolvers<void>();
      const originalExists = ctx.adapter.fs.exists.bind(ctx.adapter.fs);
      let pauseSkillsRead = true;
      ctx.adapter.fs.exists = async (path: string) => {
        if (pauseSkillsRead && path === `${ctx.projectDir}/skills`) {
          pauseSkillsRead = false;
          discoveryPaused.resolve();
          await resumeDiscovery.promise;
        }
        return originalExists(path);
      };

      const rediscovery = runWithRequestContext(
        requestContext,
        () => ensureProjectDiscovery(ctx),
      );
      await discoveryPaused.promise;

      await runWithRequestContext(requestContext, async () => {
        assertExists(skillRegistry.get("old-skill"));
        assertEquals(skillRegistry.get("new-skill"), undefined);
      });

      resumeDiscovery.resolve();
      await rediscovery;

      await runWithRequestContext(requestContext, async () => {
        assertEquals(skillRegistry.get("old-skill"), undefined);
        assertExists(skillRegistry.get("new-skill"));
      });
    });

    it("preserves the live skill registry when mutable rediscovery fails", async () => {
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();
      skillRegistryInternal.clearAll();

      const ctx = createHandlerContext(
        "/failed-atomic-discovery-project",
        "failed-atomic-discovery-project",
        "production",
      );
      ctx.projectId = "failed-atomic-discovery-project-id";
      const requestContext = {
        projectSlug: ctx.projectSlug!,
        projectId: ctx.projectId,
        token: "<TOKEN>",
        productionMode: true,
        releaseId: null,
        environmentName: "Development",
      };

      await writeSkillFile(ctx, "stable-skill");
      await runWithRequestContext(requestContext, () => ensureProjectDiscovery(ctx));

      const originalExists = ctx.adapter.fs.exists.bind(ctx.adapter.fs);
      ctx.adapter.fs.exists = (path: string) => {
        if (path === `${ctx.projectDir}/skills`) {
          return Promise.reject(new Error("skill source unavailable"));
        }
        return originalExists(path);
      };

      await assertRejects(
        () => runWithRequestContext(requestContext, () => ensureProjectDiscovery(ctx)),
        Error,
        "skill source unavailable",
      );

      await runWithRequestContext(requestContext, async () => {
        assertExists(skillRegistry.get("stable-skill"));
      });
    });

    it("preserves live resources when their source fails during rediscovery", async () => {
      resourceRegistryInternal.clearAll();

      const ctx = createHandlerContext(
        "/failed-resource-rediscovery-project",
        "failed-resource-rediscovery-project",
        "preview",
      );
      await writeResourceFile(ctx, "stable-resource");
      await ensureProjectDiscovery(ctx);
      assertExists(resourceRegistry.get("stableResource"));

      const originalExists = ctx.adapter.fs.exists.bind(ctx.adapter.fs);
      ctx.adapter.fs.exists = (path: string) => {
        if (path === `${ctx.projectDir}/resources`) {
          return Promise.reject(new Error("resource source unavailable"));
        }
        return originalExists(path);
      };

      await assertRejects(
        () => ensureProjectDiscovery(ctx),
        Error,
        "resource source unavailable",
      );
      assertExists(resourceRegistry.get("stableResource"));
    });

    it("does not deduplicate release-less discovery across environments", async () => {
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();
      skillRegistryInternal.clearAll();

      const firstCtx = createHandlerContext(
        "/shared-project-development",
        "shared-project",
        "production",
      );
      const secondCtx = createHandlerContext(
        "/shared-project-production",
        "shared-project",
        "production",
      );
      firstCtx.projectId = "shared-project-id";
      secondCtx.projectId = "shared-project-id";

      await writeSkillFile(firstCtx, "development-skill");
      await writeSkillFile(secondCtx, "production-skill");

      let markFirstDiscoveryStarted!: () => void;
      const firstDiscoveryStarted = new Promise<void>((resolve) => {
        markFirstDiscoveryStarted = resolve;
      });
      let releaseFirstDiscovery!: () => void;
      const holdFirstDiscovery = new Promise<void>((resolve) => {
        releaseFirstDiscovery = resolve;
      });
      const firstExists = firstCtx.adapter.fs.exists.bind(firstCtx.adapter.fs);
      let firstExistsCall = true;
      firstCtx.adapter.fs.exists = async (path: string) => {
        if (firstExistsCall) {
          firstExistsCall = false;
          markFirstDiscoveryStarted();
          await holdFirstDiscovery;
        }
        return firstExists(path);
      };

      const firstDiscovery = runWithRequestContext(
        {
          projectSlug: "shared-project",
          projectId: "shared-project-id",
          token: "<TOKEN>",
          productionMode: true,
          releaseId: null,
          environmentName: "Development",
        },
        () => ensureProjectDiscovery(firstCtx),
      );
      await firstDiscoveryStarted;

      const secondDiscovery = runWithRequestContext(
        {
          projectSlug: "shared-project",
          projectId: "shared-project-id",
          token: "<TOKEN>",
          productionMode: true,
          releaseId: null,
          environmentName: "Production",
        },
        () => ensureProjectDiscovery(secondCtx),
      );
      releaseFirstDiscovery();

      const [firstResult, secondResult] = await Promise.all([
        firstDiscovery,
        secondDiscovery,
      ]);
      assertEquals(firstResult.skills.has("development-skill"), true);
      assertEquals(secondResult.skills.has("production-skill"), true);

      await runWithRequestContext(
        {
          projectSlug: "shared-project",
          projectId: "shared-project-id",
          token: "<TOKEN>",
          productionMode: true,
          releaseId: null,
          environmentName: "Production",
        },
        async () => {
          assertExists(skillRegistry.get("production-skill"));
        },
      );
    });

    it("uses cache-key context to isolate production discovery by release", async () => {
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();
      skillRegistryInternal.clearAll();

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
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();
      skillRegistryInternal.clearAll();

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
          'import { defineSchema } from "veryfront/schemas";',
          "",
          "export default tool({",
          '  description: "Return a deterministic weather report",',
          "  inputSchema: defineSchema((v) => v.object({ city: v.string() }))(),",
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

    it("uses relative discovery paths for API-backed project files", async () => {
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();
      skillRegistryInternal.clearAll();

      const ctx = createHandlerContext(
        "/runtime/project",
        "api-backed-project",
        "preview",
      );
      ctx.config = {
        fs: { type: "veryfront-api" },
      } as HandlerContext["config"];

      await ctx.adapter.fs.writeFile(
        "tools/relative-tool.ts",
        [
          'import { tool } from "veryfront/tool";',
          'import { defineSchema } from "veryfront/schemas";',
          "",
          "export default tool({",
          '  id: "relative_tool",',
          '  description: "Uses API-backed relative discovery.",',
          "  inputSchema: defineSchema((v) => v.object({}))(),",
          "  execute: async () => ({ ok: true }),",
          "});",
          "",
        ].join("\n"),
      );

      const discovery = await ensureProjectDiscovery(ctx);

      assertEquals(discovery.tools.has("relative_tool"), true);
      assertEquals(toolRegistry.has("relative_tool"), true);
    });

    it("rejects partial discovery with safe diagnostics and preserves the last generation", async () => {
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();
      skillRegistryInternal.clearAll();

      const ctx = createHandlerContext(
        "/partial-discovery-project",
        "partial-discovery-project",
        "preview",
      );

      await ctx.adapter.fs.writeFile(
        `${ctx.projectDir}/tools/healthy-tool.ts`,
        [
          'import { tool } from "veryfront/tool";',
          'import { defineSchema } from "veryfront/schemas";',
          "",
          "export default tool({",
          '  id: "healthy_tool",',
          '  description: "Returns a healthy result",',
          "  inputSchema: defineSchema((v) => v.object({}))(),",
          "  execute: async () => ({ ok: true }),",
          "});",
          "",
        ].join("\n"),
      );
      await ensureProjectDiscovery(ctx);
      assertEquals(toolRegistry.has("healthy_tool"), true);

      await ctx.adapter.fs.writeFile(
        `${ctx.projectDir}/tools/candidate-tool.ts`,
        [
          'import { tool } from "veryfront/tool";',
          'import { defineSchema } from "veryfront/schemas";',
          "",
          "export default tool({",
          '  id: "candidate_tool",',
          '  description: "Must not leak from a failed generation",',
          "  inputSchema: defineSchema((v) => v.object({}))(),",
          "  execute: async () => ({ ok: true }),",
          "});",
          "",
        ].join("\n"),
      );
      await ctx.adapter.fs.writeFile(
        `${ctx.projectDir}/tools/broken-tool.ts`,
        'throw new Error("broken discovery fixture");\n',
      );

      const logEntries: LogEntry[] = [];
      __registerLogRecordEmitter((entry) => logEntries.push(entry));

      try {
        await assertRejects(
          () => ensureProjectDiscovery(ctx),
          Error,
          "Runtime discovery failed: Discovery generation rejected with 1 error",
        );
      } finally {
        __resetLogRecordEmitterForTests();
      }

      assertEquals(toolRegistry.has("healthy_tool"), true);
      assertEquals(toolRegistry.has("candidate_tool"), false);
      const partialWarning = logEntries.find((entry) =>
        entry.message === "Primitive discovery rejected; retaining previous generation"
      );
      assertExists(partialWarning);
      assertEquals(partialWarning.level, "warn");
      assertEquals(partialWarning.context?.failures, [{
        file: "tools/broken-tool.ts",
        sourceKind: "tool",
        message: "broken discovery fixture",
      }]);
      assertEquals(JSON.stringify(partialWarning).includes(ctx.projectDir), false);
    });

    it("retries partial discovery within the same source snapshot", async () => {
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();
      skillRegistryInternal.clearAll();

      const ctx = createHandlerContext(
        "/partial-discovery-retry-project",
        "partial-discovery-retry-project",
        "preview",
      );
      (
        ctx.adapter.fs as typeof ctx.adapter.fs & {
          getSourceSnapshotVersion: () => number;
        }
      ).getSourceSnapshotVersion = () => 1;

      const toolPath = `${ctx.projectDir}/tools/recovered-tool.ts`;
      await ctx.adapter.fs.writeFile(
        toolPath,
        'throw new Error("temporary discovery failure");\n',
      );

      await assertRejects(
        () => ensureProjectDiscovery(ctx),
        Error,
        "Runtime discovery failed: Discovery generation rejected with 1 error",
      );

      await ctx.adapter.fs.writeFile(
        toolPath,
        [
          'import { tool } from "veryfront/tool";',
          'import { defineSchema } from "veryfront/schemas";',
          "",
          "export default tool({",
          '  id: "recovered_tool",',
          '  description: "Recovers after a transient discovery failure",',
          "  inputSchema: defineSchema((v) => v.object({}))(),",
          "  execute: async () => ({ ok: true }),",
          "});",
          "",
        ].join("\n"),
      );

      const recovered = await ensureProjectDiscovery(ctx);
      assertEquals(recovered.errors.length, 0);
      assertEquals(recovered.tools.has("recovered_tool"), true);
    });

    it("rethrows hard primitive discovery failures instead of returning an empty result", async () => {
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();
      skillRegistryInternal.clearAll();

      const ctx = createHandlerContext(
        "/hard-failure-project",
        "hard-failure-project",
        "preview",
      );
      const exists = ctx.adapter.fs.exists.bind(ctx.adapter.fs);
      ctx.adapter.fs.exists = (path: string) => {
        if (path === `${ctx.projectDir}/skills`) {
          throw new Error("VFS unavailable");
        }
        return exists(path);
      };

      const error = await assertRejects(
        () => ensureProjectDiscovery(ctx),
        Error,
        "Runtime discovery failed: VFS unavailable",
      );
      assertExists(error);
    });

    it("does not warn about zero agents and tools when AI primitive discovery is disabled", async () => {
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();
      skillRegistryInternal.clearAll();

      const ctx = createHandlerContext(
        "/disabled-ai-discovery-project",
        "disabled-ai-discovery-project",
        "preview",
      );
      ctx.config = {
        ai: {
          tools: { discovery: { enabled: false } },
          agents: { discovery: { enabled: false } },
          skills: { discovery: { enabled: false } },
        },
      } as HandlerContext["config"];

      const originalWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (message?: unknown, ...args: unknown[]) => {
        warnings.push([message, ...args].map(String).join(" "));
      };

      try {
        await ensureProjectDiscovery(ctx);
      } finally {
        console.warn = originalWarn;
      }

      assertEquals(
        warnings.some((warning) =>
          warning.includes("Primitive discovery found 0 agents and 0 tools")
        ),
        false,
      );
    });

    it("keeps explicit tool ids available for request-time project-agent runs", async () => {
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();
      skillRegistryInternal.clearAll();

      const ctx = createHandlerContext(
        "/explicit-tool-id-project",
        "explicit-tool-id-project",
        "preview",
      );

      await ctx.adapter.fs.writeFile(
        `${ctx.projectDir}/tools/write-report.ts`,
        [
          'import { tool } from "veryfront/tool";',
          'import { defineSchema } from "veryfront/schemas";',
          "",
          "export default tool({",
          '  id: "write-report",',
          '  description: "Persist a markdown report",',
          "  inputSchema: defineSchema((v) => v.object({ markdown: v.string() }))(),",
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
      assertConfiguredSkillInfrastructure(discoveredAgent.config.tools);
      assertEquals(discoveredAgent.config.tools["write-report"], true);
    });

    it("keeps explicit generated-looking tool ids available for request-time project-agent runs", async () => {
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();
      skillRegistryInternal.clearAll();

      const ctx = createHandlerContext(
        "/explicit-generated-looking-tool-id-project",
        "explicit-generated-looking-tool-id-project",
        "preview",
      );

      await ctx.adapter.fs.writeFile(
        `${ctx.projectDir}/tools/write-report.ts`,
        [
          'import { tool } from "veryfront/tool";',
          'import { defineSchema } from "veryfront/schemas";',
          "",
          "export default tool({",
          '  id: "tool_2024_01",',
          '  description: "Persist a markdown report",',
          "  inputSchema: defineSchema((v) => v.object({ markdown: v.string() }))(),",
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
      assertConfiguredSkillInfrastructure(discoveredAgent.config.tools);
      assertEquals(discoveredAgent.config.tools.tool_2024_01, true);
    });

    it("keeps object-spread overridden tool ids available for request-time project-agent runs", async () => {
      agentRegistryInternal.clearAll();
      toolRegistryInternal.clearAll();
      skillRegistryInternal.clearAll();

      const ctx = createHandlerContext(
        "/explicit-spread-tool-id-project",
        "explicit-spread-tool-id-project",
        "preview",
      );

      await ctx.adapter.fs.writeFile(
        `${ctx.projectDir}/tools/write-report.ts`,
        [
          'import { tool } from "veryfront/tool";',
          'import { defineSchema } from "veryfront/schemas";',
          "",
          "const generated = tool({",
          '  description: "Persist a markdown report",',
          "  inputSchema: defineSchema((v) => v.object({ markdown: v.string() }))(),",
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
      assertConfiguredSkillInfrastructure(discoveredAgent.config.tools);
      assertEquals(discoveredAgent.config.tools["my-tool"], true);
    });
  },
);
