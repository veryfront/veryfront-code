/**
 * SSR transform-pipeline fixtures, which download modules through a fetch fake.
 *
 * These cases live here rather than beside the other pipeline fixtures because
 * the `ssr-http-cache` stage downloads HTTP imports so SSR can load them from
 * disk. Driving that stage means installing a fetch transport, which the
 * semantic unit-boundary audit classifies as a network effect, so the colocated
 * unit file cannot hold them. The browser-target fixtures, which need no
 * downloads at all, stay in
 * `src/transforms/pipeline/__fixtures__/fixture-runner.test.ts`.
 *
 * The fake is what makes these deterministic. Before it, the stage reached
 * esm.sh over the live network: the cases passed on a warm bundle cache and
 * failed whenever the CDN blipped, and because a failed merge-queue build
 * ejects every pull request batched into it, one blip also evicted unrelated
 * changes.
 */
import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { readTextFile, withTempDir } from "#veryfront/testing/deno-compat.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { runWithCacheDir } from "#veryfront/utils/cache-dir.ts";
import * as esbuild from "veryfront/extensions/bundler";
import { runPipeline } from "#veryfront/transforms/pipeline/index.ts";
import { TEST_REPOSITORY_ROOT } from "../../../../../../_helpers/constants.ts";

/** Fixture inputs stay with the colocated unit tests; both suites read the same sources. */
const FIXTURES_DIR = join(
  TEST_REPOSITORY_ROOT,
  "src/transforms/pipeline/__fixtures__",
);

function readFixture(name: string, file: string): Promise<string> {
  return readTextFile(join(FIXTURES_DIR, name, file));
}

const TEST_OPTIONS = {
  projectId: "test-project",
  dev: true,
  moduleServerUrl: "http://localhost:3001/_vf_modules",
};

/**
 * Module source served in place of a real download.
 *
 * These assertions are about how the pipeline rewrites imports, not about what
 * esm.sh returns, so any syntactically valid module body is enough.
 */
const STUB_MODULE_SOURCE = "export default {};\n";

/**
 * Serve esm.sh module downloads from memory, and refuse every other host.
 *
 * Refusing the rest is the point: it stops the fake from silently absorbing a
 * new network dependency that a future pipeline stage might introduce.
 */
const stubModuleFetch = ((input: string | URL | Request): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

  const { hostname } = new URL(url);
  if (hostname !== "esm.sh") {
    return Promise.reject(
      new Error(`SSR pipeline fixture attempted an unstubbed request to ${url}`),
    );
  }

  return Promise.resolve(
    new Response(STUB_MODULE_SOURCE, {
      status: 200,
      headers: { "content-type": "application/javascript" },
    }),
  );
}) as typeof fetch;

function runHermeticSsrPipeline(input: string, filePath: string) {
  return withTempDir(
    (cacheDir) =>
      runWithCacheDir(
        cacheDir,
        () =>
          withMockFetch(
            stubModuleFetch,
            () =>
              runPipeline(input, filePath, "/project", {
                ...TEST_OPTIONS,
                ssr: true,
              }),
          ),
      ),
    { prefix: "vf-ssr-pipeline-cache-" },
  );
}

describe("transform pipeline SSR fixtures", () => {
  afterAll(async () => {
    await esbuild.stop();
  });

  it("resolves React for SSR (npm: on Deno, file:// on Node/Bun)", async () => {
    const input = await readFixture("react-only", "input.tsx");

    const result = await runHermeticSsrPipeline(
      input,
      "/project/components/Counter.tsx",
    );

    assertStringIncludes(result.code, "jsx");

    // SSR on all platforms uses cached file:// paths for HTTP bundles
    assertStringIncludes(result.code, "file://");

    assertEquals(result.code.includes('from "react"'), false);
  });

  // SSR module resolution differs by runtime, so this pins the Deno behavior only.
  (isDeno ? it : it.skip)(
    "resolves React to cached file:// URLs for SSR (Deno only)",
    async () => {
      const input = await readFixture("react-query", "input.tsx");

      const result = await runHermeticSsrPipeline(
        input,
        "/project/components/UserProfile.tsx",
      );

      // SSR uses cached file:// paths for HTTP bundles
      assertStringIncludes(result.code, "file://");
      assertStringIncludes(result.code, "jsx");
    },
  );
});
