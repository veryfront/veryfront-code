import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { computeHash } from "#veryfront/utils";
import { clearReactVersionCache } from "#veryfront/transforms/esm/package-registry.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { getProdHydrationModulePath } from "#veryfront/html/hydration-script-builder/prod-scripts.ts";
import {
  buildSnippetModuleUrl,
  clearSnippetCache,
  clearSnippetCacheForProject,
  getCompiledSnippet,
  renderSnippet,
  wrapSnippetInHTMLShell,
} from "./snippet-renderer.ts";

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    deleteEnv(name);
  } else {
    setEnv(name, value);
  }
}

describe("rendering/snippet-renderer", () => {
  describe("buildSnippetModuleUrl", () => {
    it("binds SSR snippet imports to the captured dependency snapshot", () => {
      assertEquals(
        buildSnippetModuleUrl(
          "https://modules.example",
          "snippet-hash",
          123,
          "on:snapshot-a",
        ),
        "https://modules.example/_vf_modules/_snippets/snippet-hash.js?ssr=true&v=123&pins=on%3Asnapshot-a",
      );
    });

    it("preserves the flag-off URL shape", () => {
      assertEquals(
        buildSnippetModuleUrl(
          "https://modules.example",
          "snippet-hash",
          123,
          "off",
        ),
        "https://modules.example/_vf_modules/_snippets/snippet-hash.js?ssr=true&v=123",
      );
    });
  });

  describe("wrapSnippetInHTMLShell", () => {
    it("uses the hydration runtime baked into an aged release", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-snippet-release-" });
      const agedRuntimePath = "/_veryfront/hydration-runtime.1a2b3c4d.js";
      const adapter = { fs: createFileSystem() } as unknown as RuntimeAdapter;

      try {
        await Deno.mkdir(`${projectDir}/custom-output/_veryfront`, { recursive: true });
        await Deno.writeTextFile(`${projectDir}/custom-output${agedRuntimePath}`, "export {};");

        const html = await wrapSnippetInHTMLShell(
          "<main>Aged snippet</main>",
          { title: "Aged snippet", slug: "aged-snippet" },
          {
            mode: "production",
            projectDir,
            adapter,
            releaseId: "release-aged",
            moduleServerUrl: "http://127.0.0.1:3000",
            config: { build: { outDir: "custom-output" } },
          },
          {
            hash: "snippet-hash",
            moduleServerBase: "http://127.0.0.1:3000",
            dependencyPinningCacheKey: "off",
          },
        );

        assertEquals(html.includes(agedRuntimePath), true);
        assertEquals(html.includes(getProdHydrationModulePath()), false);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  describe("renderSnippet", () => {
    it("fails before caching when dependency metadata is malformed", async () => {
      const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      const projectDir = "/malformed-snippet-project";
      const projectSlug = "malformed-snippet";
      const mdxContent = "# This must not be cached";
      const hash = (await computeHash(mdxContent + projectSlug)).slice(0, 16);
      const adapter = createMockAdapter();
      const stat = adapter.fs.stat.bind(adapter.fs);
      adapter.fs.stat = async (path) => ({
        ...await stat(path),
        mtime: new Date(1),
      });
      adapter.fs.files.set(`${projectDir}/package.json`, "{not valid json");

      try {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
        clearReactVersionCache();

        await assertRejects(
          () =>
            renderSnippet(mdxContent, {
              mode: "production",
              projectDir,
              projectSlug,
              projectId: "project-a",
              adapter,
              isLocalProject: false,
            }),
          Error,
          "Dependency pinning snapshot is unavailable: on:unknown",
        );
        assertEquals(getCompiledSnippet(hash), undefined);
      } finally {
        restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
        clearReactVersionCache();
      }
    });
  });

  describe("getCompiledSnippet", () => {
    it("should return undefined for non-existent hash", () => {
      assertEquals(getCompiledSnippet("nonexistent-hash"), undefined);
    });

    it("should return undefined for empty hash", () => {
      assertEquals(getCompiledSnippet(""), undefined);
    });
  });

  describe("clearSnippetCache", () => {
    it("should clear without error", () => {
      clearSnippetCache();
      // After clearing, no snippets should be cached
      assertEquals(getCompiledSnippet("any-key"), undefined);
    });

    it("should be idempotent", () => {
      clearSnippetCache();
      clearSnippetCache();
      assertEquals(getCompiledSnippet("any-key"), undefined);
    });
  });

  describe("clearSnippetCacheForProject", () => {
    it("should clear without error for unknown project", () => {
      clearSnippetCacheForProject("unknown-project");
    });

    it("should not affect other projects", () => {
      clearSnippetCacheForProject("project-a");
      // No crash = success
    });
  });
});
