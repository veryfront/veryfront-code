import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { __moduleWriterInternals, buildMdxModuleCacheIdentity } from "./module-writer.ts";
import { mdxRenderer } from "../index.ts";
import { denoAdapter } from "#veryfront/platform/adapters/deno.ts";
import { hashString } from "#veryfront/cache/hash.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { extractDependencyPinningPathKey } from "#veryfront/transforms/import-rewriter/url-builder.ts";
import type { FileInfo } from "#veryfront/platform/adapters/base.ts";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import { VeryfrontError } from "#veryfront/errors";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import type { MDXModule } from "../types.ts";

function cacheKeyForDependencies(
  dependencies: Readonly<Record<string, string>>,
): string {
  const sortedEntries = Object.entries(dependencies).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return `on:${hashString(JSON.stringify(sortedEntries))}`;
}

const SNAPSHOT_A_DEPENDENCIES = { react: "19.1.1" } as const;
const SNAPSHOT_B_DEPENDENCIES = { react: "19.1.2" } as const;
const SNAPSHOT_A_PIN_KEY = cacheKeyForDependencies(SNAPSHOT_A_DEPENDENCIES);
const SNAPSHOT_B_PIN_KEY = cacheKeyForDependencies(SNAPSHOT_B_DEPENDENCIES);

describe("MDX root module cache identity", () => {
  it("isolates namespace, file, LRU, and import identities across pin snapshots", async () => {
    const code = "export default function MDXContent() { return null; }";
    const [snapshotA, snapshotB] = await Promise.all([
      buildMdxModuleCacheIdentity(
        "/cache/mdx",
        "project-id",
        "19.1.1",
        code,
        SNAPSHOT_A_PIN_KEY,
      ),
      buildMdxModuleCacheIdentity(
        "/cache/mdx",
        "project-id",
        "19.1.1",
        code,
        SNAPSHOT_B_PIN_KEY,
      ),
    ]);

    assertEquals(snapshotA.codeHash, snapshotB.codeHash);
    assertEquals(snapshotA.namespaceKey === snapshotB.namespaceKey, false);
    assertEquals(snapshotA.compositeKey === snapshotB.compositeKey, false);
    assertEquals(snapshotA.filePath === snapshotB.filePath, false);
    assertEquals(snapshotA.importUrl === snapshotB.importUrl, false);
  });

  it("preserves the flag-off cache identity", async () => {
    const code = "export const value = 1;";
    const [omitted, flagOff] = await Promise.all([
      buildMdxModuleCacheIdentity("/cache/mdx", "project-id", "19.1.1", code),
      buildMdxModuleCacheIdentity(
        "/cache/mdx",
        "project-id",
        "19.1.1",
        code,
        "off",
      ),
    ]);

    assertEquals(flagOff, omitted);
  });

  it("isolates pin-on root modules by request origin", async () => {
    const code = "export const value = 1;";
    const [originA, originB] = await Promise.all([
      buildMdxModuleCacheIdentity(
        "/cache/mdx",
        "project-id",
        "19.1.1",
        code,
        SNAPSHOT_A_PIN_KEY,
        "https://a.example",
      ),
      buildMdxModuleCacheIdentity(
        "/cache/mdx",
        "project-id",
        "19.1.1",
        code,
        SNAPSHOT_A_PIN_KEY,
        "https://b.example",
      ),
    ]);

    assertEquals(originA.namespaceKey === originB.namespaceKey, false);
    assertEquals(originA.compositeKey === originB.compositeKey, false);
  });

  it("pins a top-level same-origin absolute module before strict SSR fetching", async () => {
    const modulePath = `/_vf_modules/StrictChild-${crypto.randomUUID()}.js`;
    const dependencies = {};
    const snapshotPinKey = cacheKeyForDependencies(dependencies);
    let validRequests = 0;
    let rawRequests = 0;
    const origin = "https://93.184.216.34";
    const projectDir = await Deno.makeTempDir({ prefix: "vf-mdx-origin-" });

    try {
      const mod = await withMockFetch(
        async (input, init) => {
          const request = new Request(input, init);
          const url = new URL(request.url);
          const pinnedPath = extractDependencyPinningPathKey(url.pathname);
          if (pinnedPath.pathname !== modulePath) {
            return new Response("not found", { status: 404 });
          }
          const queryPins = url.searchParams.getAll("pins");
          const requestedPins = [
            ...(pinnedPath.found && pinnedPath.cacheKey ? [pinnedPath.cacheKey] : []),
            ...queryPins,
          ];
          if (
            pinnedPath.malformed ||
            requestedPins.length !== 1 ||
            requestedPins[0] !== snapshotPinKey ||
            url.searchParams.get("ssr") !== "true"
          ) {
            rawRequests++;
            return new Response("missing dependency snapshot", { status: 409 });
          }

          validRequests++;
          return new Response('export default "STRICT_CHILD_OK";', {
            headers: { "content-type": "application/javascript" },
          });
        },
        () =>
          mdxRenderer.loadModuleESM(
            `import child from "${origin}${modulePath}";\nexport default child;`,
            {
              adapter: denoAdapter,
              projectId: `project-${crypto.randomUUID()}`,
              projectDir,
              projectSlug: "strict-origin",
              contentSourceId: `source-${crypto.randomUUID()}`,
              reactVersion: "19.1.1",
              dependencyPinningCacheKey: snapshotPinKey,
              dependencyPinningDependencies: dependencies,
              dependencyPinningSource: projectDir,
              moduleServerOrigin: origin,
              isLocalProject: true,
            },
          ),
      );

      assertEquals(mod.default as unknown, "STRICT_CHILD_OK");
      assertEquals(validRequests > 0, true);
      assertEquals(rawRequests, 0);
    } finally {
      mdxRenderer.clearCache();
      await Deno.remove(projectDir, { recursive: true });
      const esbuild = await import("veryfront/extensions/bundler");
      await esbuild.stop();
    }
  });
});

describe("MDX root dynamic imports", () => {
  it("defers a missing strict alias import until its branch executes", async () => {
    const missingModule = `MissingRoot-${crypto.randomUUID()}`;
    const projectDir = await Deno.makeTempDir({ prefix: "vf-mdx-root-dynamic-" });

    try {
      const mod = await withMockFetch(
        () => Promise.resolve(new Response("missing", { status: 404 })),
        () =>
          mdxRenderer.loadModuleESM(
            `export async function loadOptional(enabled) {
              if (!enabled) return "SKIPPED";
              return (await import("@/${missingModule}")).default;
            }
            export default function Root() { return null; }`,
            {
              adapter: denoAdapter,
              projectId: `project-${crypto.randomUUID()}`,
              projectDir,
              projectSlug: "root-dynamic",
              contentSourceId: `source-${crypto.randomUUID()}`,
              isLocalProject: true,
            },
          ),
      );
      const loadOptional = (mod as unknown as {
        loadOptional(enabled: boolean): Promise<string>;
      }).loadOptional;

      assertEquals(await loadOptional(false), "SKIPPED");
      await assertRejects(
        () => loadOptional(true),
        Error,
        `Missing module: _vf_modules/${missingModule}.js`,
      );
    } finally {
      mdxRenderer.clearCache();
      await Deno.remove(projectDir, { recursive: true });
      const esbuild = await import("veryfront/extensions/bundler");
      await esbuild.stop();
    }
  });
});

describe("verifyMdxCacheFile", () => {
  const { verifyMdxCacheFile } = __moduleWriterInternals;

  const FILE_STAT: FileInfo = {
    isFile: true,
    isDirectory: false,
    isSymlink: false,
    size: 100,
    mtime: null,
  };

  function filesystemError(message: string, code: string): Error & { code: string } {
    return Object.assign(new Error(message), { code });
  }

  function createStatFs(stat: FileSystem["stat"]): FileSystem {
    return { stat } as FileSystem;
  }

  function createContext(): { moduleCache: LRUCache<string, MDXModule> } {
    return { moduleCache: new LRUCache<string, MDXModule>({ maxEntries: 10 }) };
  }

  it("returns true when the cache file exists", async () => {
    const result = await verifyMdxCacheFile(
      createStatFs(() => Promise.resolve(FILE_STAT)),
      "/cache/module.mjs",
      createContext(),
      "ns:hash",
    );

    assertEquals(result, true);
  });

  it("returns false when the cache file is genuinely absent", async () => {
    const result = await verifyMdxCacheFile(
      createStatFs(() => Promise.reject(filesystemError("not found", "ENOENT"))),
      "/cache/module.mjs",
      createContext(),
      "ns:hash",
    );

    assertEquals(result, false);
  });

  it("wraps operational stat failures in CACHE_ERROR with the original cause", async () => {
    const original = filesystemError("permission denied", "EACCES");

    const error = await assertRejects(
      () =>
        verifyMdxCacheFile(
          createStatFs(() => Promise.reject(original)),
          "/cache/module.mjs",
          createContext(),
          "ns:hash",
        ),
      VeryfrontError,
      "MDX module cache file inspection failed",
    ) as VeryfrontError;

    assertEquals(error.slug, "cache-error");
    assertEquals(error.cause, original);
    assertEquals(error.message.includes("/cache/module.mjs"), false);
  });

  it("invalidates the stale module index entry on operational stat failures", async () => {
    const context = createContext();
    context.moduleCache.set("ns:hash", {} as MDXModule);
    context.moduleCache.set("ns:other", {} as MDXModule);

    await assertRejects(
      () =>
        verifyMdxCacheFile(
          createStatFs(() => Promise.reject(filesystemError("io error", "EIO"))),
          "/cache/module.mjs",
          context,
          "ns:hash",
        ),
      VeryfrontError,
    );

    assertEquals(context.moduleCache.has("ns:hash"), false);
    assertEquals(context.moduleCache.has("ns:other"), true);
  });
});
