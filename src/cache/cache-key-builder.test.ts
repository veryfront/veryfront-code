import "#veryfront/schemas/_test-setup.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it } from "#veryfront/testing/bdd";
import {
  assertEquals,
  assertExists,
  assertNotEquals,
  assertThrows,
} from "#veryfront/testing/assert";
import {
  type CacheKeyContext,
  getContentHashKey,
  getCurrentCacheKeyContext,
  getProjectScopedKey,
  getProjectScopedKeyAlways,
  isRegistryScopeForProject,
  registerMultiProjectRequestContextProvider,
  runWithCacheKeyContext,
  tryGetCacheKeyContext,
  tryGetRegistryScopeContext,
  tryGetRegistryScopeId,
} from "./cache-key-builder.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";

describe("cache-key-builder", () => {
  describe("getContentHashKey", () => {
    it("should build key without suffix", () => {
      assertEquals(
        getContentHashKey("prefix", "pages/index.tsx", "abc123"),
        "content-hash:v2:InByZWZpeCI:InBhZ2VzL2luZGV4LnRzeCI:ImFiYzEyMyI:Im5vbmUi",
      );
    });

    it("should build key with suffix", () => {
      assertEquals(
        getContentHashKey("prefix", "pages/index.tsx", "abc123", "ssr"),
        "content-hash:v2:InByZWZpeCI:InBhZ2VzL2luZGV4LnRzeCI:ImFiYzEyMyI:InZhbHVlOnNzciI",
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

    it("rejects replacement of the registered ambient provider", () => {
      assertThrows(
        () =>
          registerMultiProjectRequestContextProvider(() => ({
            projectSlug: "attacker-project",
            token: "attacker-token",
            productionMode: false,
          })),
        Error,
        "already registered",
      );
    });

    it("uses captured context and encoding primordials for explicit and ambient scopes", async () => {
      const originalGetStore = AsyncLocalStorage.prototype.getStore;
      const originalRun = AsyncLocalStorage.prototype.run;
      const originalEncodeURIComponent = globalThis.encodeURIComponent;
      const originalStartsWith = String.prototype.startsWith;
      let explicitScope: ReturnType<typeof tryGetRegistryScopeContext> | undefined;
      let ambientScope: ReturnType<typeof tryGetRegistryScopeContext> | undefined;
      let projectMatched = false;

      try {
        AsyncLocalStorage.prototype.getStore = (() => {
          throw new Error("ambient AsyncLocalStorage.getStore must not run");
        }) as typeof AsyncLocalStorage.prototype.getStore;
        AsyncLocalStorage.prototype.run = (() => {
          throw new Error("ambient AsyncLocalStorage.run must not run");
        }) as typeof AsyncLocalStorage.prototype.run;
        globalThis.encodeURIComponent = (() => {
          throw new Error("ambient encodeURIComponent must not run");
        }) as typeof globalThis.encodeURIComponent;

        explicitScope = runWithCacheKeyContext(
          {
            projectId: "workflow:project",
            mode: "production",
            versionId: "release:explicit",
          },
          () => tryGetRegistryScopeContext(),
        );
        ambientScope = await runWithRequestContext(
          {
            projectSlug: "ambient-project",
            projectId: "ambient:project",
            token: "<TOKEN>",
            productionMode: true,
            releaseId: "release:ambient",
          },
          async () => tryGetRegistryScopeContext(),
        );

        String.prototype.startsWith = (() => {
          throw new Error("ambient String.startsWith must not run");
        }) as typeof String.prototype.startsWith;
        projectMatched = isRegistryScopeForProject(
          "ambient%3Aproject:production:release%3Aambient",
          "ambient:project",
        );
      } finally {
        AsyncLocalStorage.prototype.getStore = originalGetStore;
        AsyncLocalStorage.prototype.run = originalRun;
        globalThis.encodeURIComponent = originalEncodeURIComponent;
        String.prototype.startsWith = originalStartsWith;
      }

      assertEquals(explicitScope, {
        scopeId: "workflow%3Aproject:production:release%3Aexplicit",
        immutable: true,
      });
      assertEquals(ambientScope, {
        scopeId: "ambient%3Aproject:production:release%3Aambient",
        immutable: true,
      });
      assertEquals(projectMatched, true);
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
        scopeId: "project-id:production:release-id",
        immutable: true,
      });
      assertEquals(branch, {
        scopeId: "project-id:preview:feature",
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
        scopeId: "project-id:production:environment:Development",
        immutable: false,
      });
      assertEquals(production, {
        scopeId: "project-id:production:environment:Production",
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
        scopeId: "project-id:production:environment:production",
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
        scopeId: "workflow-project:production:workflow-release",
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
        scopeId: "project-id:production:outer-release",
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
          scopeId: "project-id:production:release-id",
          immutable: true,
        },
        id: "project-id:production:release-id",
      });
    });

    it("encodes variable segments so distinct explicit scopes cannot collide", () => {
      const left = runWithCacheKeyContext(
        { projectId: "a:preview", mode: "preview", versionId: "x" },
        () => tryGetRegistryScopeId(),
      );
      const right = runWithCacheKeyContext(
        { projectId: "a", mode: "preview", versionId: "preview:x" },
        () => tryGetRegistryScopeId(),
      );
      const escapedDelimiter = runWithCacheKeyContext(
        { projectId: ":", mode: "preview", versionId: "x" },
        () => tryGetRegistryScopeId(),
      );
      const literalEscape = runWithCacheKeyContext(
        { projectId: "%3A", mode: "preview", versionId: "x" },
        () => tryGetRegistryScopeId(),
      );

      assertEquals(left, "a%3Apreview:preview:x");
      assertEquals(right, "a:preview:preview%3Ax");
      assertNotEquals(left, right);
      assertEquals(escapedDelimiter, "%3A:preview:x");
      assertEquals(literalEscape, "%253A:preview:x");
      assertNotEquals(escapedDelimiter, literalEscape);
    });

    it("encodes release, branch, and environment scope segments", async () => {
      const release = await runWithRequestContext(
        {
          projectSlug: "project",
          projectId: "project:id",
          token: "<TOKEN>",
          productionMode: true,
          releaseId: "release:id",
        },
        async () => tryGetRegistryScopeId(),
      );
      const branch = await runWithRequestContext(
        {
          projectSlug: "project",
          projectId: "project:id",
          token: "<TOKEN>",
          productionMode: false,
          branch: "feature:branch",
        },
        async () => tryGetRegistryScopeId(),
      );
      const environment = await runWithRequestContext(
        {
          projectSlug: "project",
          projectId: "project:id",
          token: "<TOKEN>",
          productionMode: true,
          releaseId: null,
          environmentName: "environment:name",
        },
        async () => tryGetRegistryScopeId(),
      );

      assertEquals(release, "project%3Aid:production:release%3Aid");
      assertEquals(branch, "project%3Aid:preview:feature%3Abranch");
      assertEquals(environment, "project%3Aid:production:environment:environment%3Aname");
    });

    it("keeps scope encoding total for lone UTF-16 surrogates", () => {
      const loneSurrogate = runWithCacheKeyContext(
        { projectId: "\uD800", mode: "preview", versionId: "x" },
        () => tryGetRegistryScopeId(),
      );
      const literalEscape = runWithCacheKeyContext(
        { projectId: "%uD800", mode: "preview", versionId: "x" },
        () => tryGetRegistryScopeId(),
      );

      assertEquals(loneSurrogate, "%uD800:preview:x");
      assertEquals(literalEscape, "%25uD800:preview:x");
      assertNotEquals(loneSurrogate, literalEscape);
    });

    it("matches encoded scope IDs to raw project IDs without scope-ID ambiguity", () => {
      const scopeId = "project%3Aid:preview:feature%3Abranch";

      assertEquals(isRegistryScopeForProject(scopeId, "project:id"), true);
      assertEquals(isRegistryScopeForProject(scopeId, "project"), false);
      assertEquals(isRegistryScopeForProject(scopeId, "project:id-other"), false);
      assertEquals(
        isRegistryScopeForProject("project:preview:main", "project:preview:main"),
        false,
      );
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

      assertEquals(
        key,
        "project-scoped:v2:6:prefix|4:test|10:production|7:rel_123|8:resource",
      );
    });

    it("does not alias delimiters across prefix, project, version, or resource segments", () => {
      const prefixProjectLeft = runWithCacheKeyContext(
        { projectId: "b", mode: "production", versionId: "release" },
        () => getProjectScopedKey("scope:a", "resource"),
      );
      const prefixProjectRight = runWithCacheKeyContext(
        { projectId: "a:b", mode: "production", versionId: "release" },
        () => getProjectScopedKey("scope", "resource"),
      );
      const versionResourceLeft = runWithCacheKeyContext(
        { projectId: "tenant", mode: "production", versionId: "release:path" },
        () => getProjectScopedKey("scope", "entry"),
      );
      const versionResourceRight = runWithCacheKeyContext(
        { projectId: "tenant", mode: "production", versionId: "release" },
        () => getProjectScopedKey("scope", "path:entry"),
      );

      assertNotEquals(prefixProjectLeft, prefixProjectRight);
      assertNotEquals(versionResourceLeft, versionResourceRight);
    });

    it("keeps distinct lone-surrogate identities distinct after UTF-8 serialization", () => {
      const highSurrogate = runWithCacheKeyContext(
        { projectId: "\uD800", mode: "production", versionId: "release" },
        () => getProjectScopedKey("scope", "resource"),
      );
      const lowSurrogate = runWithCacheKeyContext(
        { projectId: "\uDFFF", mode: "production", versionId: "release" },
        () => getProjectScopedKey("scope", "resource"),
      );
      const literalEscape = runWithCacheKeyContext(
        { projectId: "%uD800", mode: "production", versionId: "release" },
        () => getProjectScopedKey("scope", "resource"),
      );
      const encoder = new TextEncoder();
      assertExists(highSurrogate);
      assertExists(lowSurrogate);
      assertExists(literalEscape);

      assertNotEquals(
        encoder.encode(highSurrogate),
        encoder.encode(lowSurrogate),
      );
      assertNotEquals(
        encoder.encode(highSurrogate),
        encoder.encode(literalEscape),
      );
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

      assertEquals(
        key,
        "project-scoped:v2:6:prefix|4:test|7:preview|4:main|8:resource",
      );
    });

    it("does not alias delimiter-bearing preview versions and resources", () => {
      const versionLeft = runWithCacheKeyContext(
        { projectId: "tenant", mode: "preview", versionId: "branch:path" },
        () => getProjectScopedKeyAlways("scope", "entry"),
      );
      const resourceRight = runWithCacheKeyContext(
        { projectId: "tenant", mode: "preview", versionId: "branch" },
        () => getProjectScopedKeyAlways("scope", "path:entry"),
      );

      assertNotEquals(versionLeft, resourceRight);
    });
  });
});
