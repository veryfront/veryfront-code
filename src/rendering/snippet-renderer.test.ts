import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import type { ContentProcessor } from "#veryfront/extensions/content/index.ts";
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

/**
 * Drive renderSnippet past its dependency-snapshot guard and into the compile
 * step with a stub ContentProcessor, so both the error path and the cache
 * seeding path are reachable without the MDX extension.
 */
async function withContentProcessor<T>(
  compileMdx: ContentProcessor["compileMdx"],
  fn: () => Promise<T>,
): Promise<T> {
  const previous = tryResolve<ContentProcessor>("ContentProcessor");
  register<ContentProcessor>("ContentProcessor", {
    compileMdx,
    compileMarkdown: compileMdx,
    getRemarkPlugins: () => [],
    getRehypePlugins: () => [],
  });
  try {
    return await fn();
  } finally {
    unregister("ContentProcessor");
    if (previous !== undefined) register<ContentProcessor>("ContentProcessor", previous);
  }
}

/** Compile stub that always succeeds, so renderSnippet reaches its cache write. */
const compileToStubModule: ContentProcessor["compileMdx"] = () =>
  Promise.resolve({
    compiledCode: "export default function Snippet() { return null; }",
    frontmatter: {},
    globals: {},
  });

/**
 * Module server base that cannot be dialled by construction: the port is outside
 * the valid range, so `import()` rejects while parsing the specifier and no
 * socket is ever opened. renderSnippet writes the snippet cache entry before it
 * imports the compiled module, so seeding only needs that import to fail -- and
 * failing at URL-parse time keeps this unit hermetic instead of betting that a
 * fixed "unroutable" port is unused on the host running the suite.
 */
const UNDIALABLE_MODULE_SERVER_URL = "http://127.0.0.1:99999";

/** Seed the snippet cache for one project and return the entry's hash. */
async function seedSnippet(mdxContent: string, projectSlug: string): Promise<string> {
  const adapter = createMockAdapter();
  await withContentProcessor(
    compileToStubModule,
    () =>
      renderSnippet(mdxContent, {
        mode: "production",
        projectDir: "/snippet-cache-project",
        projectSlug,
        projectId: "snippet-cache-project",
        adapter,
        isLocalProject: false,
        moduleServerUrl: UNDIALABLE_MODULE_SERVER_URL,
      }),
  );
  const hash = (await computeHash(mdxContent + projectSlug)).slice(0, 16);
  assertEquals(
    getCompiledSnippet(hash) !== undefined,
    true,
    "seeding must leave the compiled snippet in the cache without dialling a module server",
  );
  return hash;
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

    /** Compile stub whose failure message carries attacker-influenced markup. */
    const failWithHostileMessage: ContentProcessor["compileMdx"] = () =>
      Promise.reject(new Error("compile failed <img src=x onerror=1>"));

    async function renderFailingSnippet(mode: "development" | "production"): Promise<string> {
      const adapter = createMockAdapter();
      const result = await withContentProcessor(
        failWithHostileMessage,
        () =>
          renderSnippet("# Never compiles", {
            mode,
            projectDir: "/snippet-error-project",
            projectSlug: `snippet-error-${mode}`,
            projectId: "snippet-error-project",
            adapter,
            isLocalProject: false,
          }),
      );
      return result.html;
    }

    it("keeps server stack frames out of a production error page", async () => {
      const html = await renderFailingSnippet("production");

      assertEquals(
        html.includes('<div class="error-stack">'),
        false,
        "production snippet errors must not emit a stack block",
      );
      assertEquals(
        html.includes(" at "),
        false,
        "production snippet errors must not leak stack frames",
      );
    });

    it("shows the stack on a development error page", async () => {
      const html = await renderFailingSnippet("development");

      assertEquals(
        html.includes('<div class="error-stack">'),
        true,
        "development snippet errors must show the stack",
      );
    });

    it("escapes the compile error message in the error page", async () => {
      const html = await renderFailingSnippet("production");

      assertEquals(
        html.includes("&lt;img src=x onerror=1&gt;"),
        true,
        "the compile error message must be HTML-escaped",
      );
      assertEquals(
        html.includes("<img src=x"),
        false,
        "an attacker-influenced compile error message must never reach the page as markup",
      );
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
    it("should evict every cached snippet", async () => {
      const hash = await seedSnippet("# Global clear", "clear-all-project");
      assertEquals(
        getCompiledSnippet(hash) !== undefined,
        true,
        "the snippet must be cached before clearing",
      );

      clearSnippetCache();

      assertEquals(
        getCompiledSnippet(hash),
        undefined,
        "clearSnippetCache must evict every cached snippet",
      );
    });

    it("should be idempotent", async () => {
      const hash = await seedSnippet("# Idempotent clear", "clear-idempotent-project");
      assertEquals(
        getCompiledSnippet(hash) !== undefined,
        true,
        "the snippet must be cached before clearing",
      );

      clearSnippetCache();
      clearSnippetCache();

      assertEquals(
        getCompiledSnippet(hash),
        undefined,
        "clearing an already empty cache must leave it empty",
      );
    });
  });

  describe("clearSnippetCacheForProject", () => {
    it("should clear without error for unknown project", async () => {
      const hashA = await seedSnippet("# Unknown project A", "project-a");
      const hashB = await seedSnippet("# Unknown project B", "project-b");

      clearSnippetCacheForProject("unknown-project");

      assertEquals(
        getCompiledSnippet(hashA) !== undefined,
        true,
        "clearing an unknown project must leave project-a's compiled snippet intact",
      );
      assertEquals(
        getCompiledSnippet(hashB) !== undefined,
        true,
        "clearing an unknown project must leave project-b's compiled snippet intact",
      );
      clearSnippetCache();
    });

    it("should not affect other projects", async () => {
      const hashA = await seedSnippet("# Tenant A", "project-a");
      const hashB = await seedSnippet("# Tenant B", "project-b");

      clearSnippetCacheForProject("project-a");

      assertEquals(
        getCompiledSnippet(hashA),
        undefined,
        "clearSnippetCacheForProject must evict the target project's compiled snippets",
      );
      assertEquals(
        getCompiledSnippet(hashB) !== undefined,
        true,
        "clearing project-a must leave project-b's compiled snippet intact",
      );
      clearSnippetCache();
    });
  });
});
