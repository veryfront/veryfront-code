import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertNotEquals, assertThrows } from "#veryfront/testing/assert";
import {
  type CacheKeyContext,
  getContentHashKey,
  getCurrentCacheKeyContext,
  getProjectScopedKey,
  getProjectScopedKeyAlways,
  registryScopeMatchesProject,
  runWithCacheKeyContext,
  tryGetCacheKeyContext,
  tryGetRegistryScopeContext,
  tryGetRegistryScopeId,
} from "./cache-key-builder.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";

function expectedRegistryScope(...segments: string[]): string {
  return `scope-v1${segments.map((segment) => `:${segment.length}:${segment}`).join("")}`;
}

describe("cache-key-builder", () => {
  describe("getContentHashKey", () => {
    it("should build key without suffix", () => {
      assertEquals(
        getContentHashKey("prefix", "pages/index.tsx", "abc123"),
        "prefix:pages/index.tsx:abc123",
      );
    });

    it("should build key with suffix", () => {
      assertEquals(
        getContentHashKey("prefix", "pages/index.tsx", "abc123", "ssr"),
        "prefix:pages/index.tsx:abc123:ssr",
      );
    });

    it("keeps delimiter-bearing field boundaries distinct", () => {
      assertNotEquals(
        getContentHashKey("prefix", "pages:index.tsx", "abc123"),
        getContentHashKey("prefix:pages", "index.tsx", "abc123"),
      );
    });
  });

  describe("runWithCacheKeyContext", () => {
    it("should provide context within callback", () => {
      const ctx: CacheKeyContext = {
        projectId: "test-project",
        mode: "production",
        versionId: "rel_123",
      };

      const result = runWithCacheKeyContext(ctx, getCurrentCacheKeyContext);

      assertEquals(result, ctx);
    });

    it("should throw on invalid context", () => {
      const invalidCtx: CacheKeyContext = {
        projectId: "",
        mode: "production",
        versionId: "rel_123",
      };

      assertThrows(() => runWithCacheKeyContext(invalidCtx, () => {}), Error);
    });
  });

  describe("getCurrentCacheKeyContext", () => {
    it("should throw when no context set", () => {
      assertThrows(
        () => getCurrentCacheKeyContext(),
        Error,
        "No cache context available",
      );
    });
  });

  describe("tryGetCacheKeyContext", () => {
    it("should return null when no context set", () => {
      assertEquals(tryGetCacheKeyContext(), null);
    });

    it("should return context when set", () => {
      const ctx: CacheKeyContext = {
        projectId: "test",
        mode: "production",
        versionId: "v1",
      };

      const result = runWithCacheKeyContext(ctx, tryGetCacheKeyContext);

      assertEquals(result?.projectId, "test");
    });

    it("uses the current adapter with its receiver intact", () => {
      const globals = globalThis as Record<string, unknown>;
      const originalAdapter = globals.__vf_multi_project_adapter;
      const adapter = {
        context: {
          projectSlug: "project",
          projectId: "project-id",
          token: "<TOKEN>",
          productionMode: true,
          releaseId: "release-id",
        },
        getCurrentRequestContext() {
          if (this !== adapter) throw new Error("missing receiver");
          return this.context;
        },
      };
      globals.__vf_multi_project_adapter = adapter;

      try {
        assertEquals(tryGetCacheKeyContext(), {
          projectId: "project-id",
          mode: "production",
          versionId: "release-id",
        });
      } finally {
        globals.__vf_multi_project_adapter = originalAdapter;
      }
    });

    it("fails closed when the ambient adapter throws or returns malformed identity", () => {
      const globals = globalThis as Record<string, unknown>;
      const originalAdapter = globals.__vf_multi_project_adapter;

      try {
        globals.__vf_multi_project_adapter = {
          getCurrentRequestContext: () => {
            throw new Error("adapter unavailable");
          },
        };
        assertEquals(tryGetCacheKeyContext(), null);

        globals.__vf_multi_project_adapter = {
          getCurrentRequestContext: () => ({
            projectSlug: "project",
            projectId: 42,
            productionMode: true,
            releaseId: "release-id",
          }),
        };
        assertEquals(tryGetCacheKeyContext(), null);
      } finally {
        globals.__vf_multi_project_adapter = originalAdapter;
      }
    });
  });

  describe("tryGetRegistryScopeContext", () => {
    it("returns null without project identity", async () => {
      const result = await runWithRequestContext(
        {
          projectSlug: "",
          token: "<TOKEN>",
          productionMode: true,
          environmentName: "Development",
        },
        async () => tryGetRegistryScopeContext(),
      );

      assertEquals(result, null);
    });

    it("uses immutable release and mutable branch scopes", async () => {
      const release = await runWithRequestContext(
        {
          projectSlug: "project",
          projectId: "project-id",
          token: "<TOKEN>",
          productionMode: true,
          releaseId: "release-id",
        },
        async () => tryGetRegistryScopeContext(),
      );
      const branch = await runWithRequestContext(
        {
          projectSlug: "project",
          projectId: "project-id",
          token: "<TOKEN>",
          productionMode: false,
          branch: "feature",
        },
        async () => tryGetRegistryScopeContext(),
      );

      assertEquals(release, {
        scopeId: expectedRegistryScope("project-id", "production", "release-id"),
        immutable: true,
      });
      assertEquals(branch, {
        scopeId: expectedRegistryScope("project-id", "preview", "feature"),
        immutable: false,
      });
    });

    it("isolates release-less environments for the same project", async () => {
      const development = await runWithRequestContext(
        {
          projectSlug: "project",
          projectId: "project-id",
          token: "<TOKEN>",
          productionMode: true,
          releaseId: null,
          environmentName: "Development",
        },
        async () => tryGetRegistryScopeContext(),
      );
      const production = await runWithRequestContext(
        {
          projectSlug: "project",
          projectId: "project-id",
          token: "<TOKEN>",
          productionMode: true,
          releaseId: null,
          environmentName: "Production",
        },
        async () => tryGetRegistryScopeContext(),
      );

      assertEquals(development, {
        scopeId: expectedRegistryScope(
          "project-id",
          "production",
          "environment",
          "Development",
        ),
        immutable: false,
      });
      assertEquals(production, {
        scopeId: expectedRegistryScope(
          "project-id",
          "production",
          "environment",
          "Production",
        ),
        immutable: false,
      });
    });

    it("uses the canonical production environment when its name is omitted", async () => {
      const result = await runWithRequestContext(
        {
          projectSlug: "project",
          projectId: "project-id",
          token: "<TOKEN>",
          productionMode: true,
          releaseId: null,
          environmentName: null,
        },
        async () => tryGetRegistryScopeContext(),
      );

      assertEquals(result, {
        scopeId: expectedRegistryScope(
          "project-id",
          "production",
          "environment",
          "production",
        ),
        immutable: false,
      });
    });

    it("keeps an explicit cache scope authoritative inside a filesystem source", async () => {
      const result = await runWithRequestContext(
        {
          projectSlug: "project",
          projectId: "filesystem-project",
          token: "<TOKEN>",
          productionMode: true,
          releaseId: "filesystem-release",
        },
        async () =>
          runWithCacheKeyContext(
            {
              projectId: "workflow-project",
              mode: "production",
              versionId: "workflow-release",
            },
            () => tryGetRegistryScopeContext(),
          ),
      );

      assertEquals(result, {
        scopeId: expectedRegistryScope("workflow-project", "production", "workflow-release"),
        immutable: true,
      });
    });

    it("keeps an outer explicit cache scope authoritative over nested filesystem work", async () => {
      const result = await runWithCacheKeyContext(
        {
          projectId: "project-id",
          mode: "production",
          versionId: "outer-release",
        },
        () =>
          runWithRequestContext(
            {
              projectSlug: "project",
              projectId: "project-id",
              token: "<TOKEN>",
              productionMode: true,
              releaseId: null,
              environmentName: "Development",
            },
            async () => tryGetRegistryScopeContext(),
          ),
      );

      assertEquals(result, {
        scopeId: expectedRegistryScope("project-id", "production", "outer-release"),
        immutable: true,
      });
    });

    it("keeps explicit cache contexts available without a filesystem source", () => {
      const scope = runWithCacheKeyContext(
        { projectId: "project-id", mode: "production", versionId: "release-id" },
        () => ({
          context: tryGetRegistryScopeContext(),
          id: tryGetRegistryScopeId(),
        }),
      );

      assertEquals(scope, {
        context: {
          scopeId: expectedRegistryScope("project-id", "production", "release-id"),
          immutable: true,
        },
        id: expectedRegistryScope("project-id", "production", "release-id"),
      });
    });

    it("uses an injective scope encoding for delimiter-bearing identities", () => {
      const left = runWithCacheKeyContext(
        {
          projectId: "tenant:production",
          mode: "preview",
          versionId: "feature",
        },
        tryGetRegistryScopeId,
      );
      const right = runWithCacheKeyContext(
        {
          projectId: "tenant",
          mode: "production",
          versionId: "preview:feature",
        },
        tryGetRegistryScopeId,
      );

      assertEquals(left === right, false);
      assertEquals(registryScopeMatchesProject(left!, "tenant:production"), true);
      assertEquals(registryScopeMatchesProject(left!, "tenant"), false);
      assertEquals(registryScopeMatchesProject(left!, left!), false);
    });
  });

  describe("getProjectScopedKey", () => {
    it("should return null when no context", () => {
      assertEquals(getProjectScopedKey("prefix", "resource"), null);
    });

    it("should return null for preview mode", () => {
      const ctx: CacheKeyContext = {
        projectId: "test",
        mode: "preview",
        versionId: "main",
      };

      const key = runWithCacheKeyContext(ctx, () => getProjectScopedKey("prefix", "resource"));

      assertEquals(key, null);
    });

    it("should return key for production mode", () => {
      const ctx: CacheKeyContext = {
        projectId: "test",
        mode: "production",
        versionId: "rel_123",
      };

      const key = runWithCacheKeyContext(ctx, () => getProjectScopedKey("prefix", "resource"));

      assertEquals(key, "prefix:test:production:rel_123:resource");
    });

    it("does not collide when identity boundaries contain delimiters", () => {
      const left = runWithCacheKeyContext(
        {
          projectId: "tenant:production",
          mode: "production",
          versionId: "release",
        },
        () => getProjectScopedKey("prefix", "resource"),
      );
      const right = runWithCacheKeyContext(
        {
          projectId: "tenant",
          mode: "production",
          versionId: "production:release",
        },
        () => getProjectScopedKey("prefix", "resource"),
      );

      assertEquals(left === right, false);
    });
  });

  describe("getProjectScopedKeyAlways", () => {
    it("should return key even for preview mode", () => {
      const ctx: CacheKeyContext = {
        projectId: "test",
        mode: "preview",
        versionId: "main",
      };

      const key = runWithCacheKeyContext(
        ctx,
        () => getProjectScopedKeyAlways("prefix", "resource"),
      );

      assertEquals(key, "prefix:test:preview:main:resource");
    });
  });
});
