import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FileCache } from "#veryfront/platform/adapters/fs/cache/file-cache.ts";
import { buildGitHubCacheRef } from "./cache-scope.ts";
import { GitHubStatOperations } from "./stat-operations.ts";

describe("GitHub cache scope", () => {
  it("isolates repositories that use the same ref", () => {
    const first = buildGitHubCacheRef({
      owner: "owner-a",
      repo: "site",
      ref: "main",
    });
    const second = buildGitHubCacheRef({
      owner: "owner-b",
      repo: "site",
      ref: "main",
    });

    assertEquals(first === second, false);
  });

  it("encodes delimiter characters in repository identity and refs", () => {
    assertEquals(
      buildGitHubCacheRef({
        owner: "owner:name",
        repo: "site/name",
        ref: "feature/cache:key",
      }),
      "owner%3Aname:site%2Fname:feature%2Fcache%3Akey",
    );
  });

  it("isolates stat and resolve cache entries by repository", async () => {
    const baseConfig = {
      ref: "main",
      token: "test-token",
      basePath: "",
      retry: { maxRetries: 3, initialDelay: 1000, maxDelay: 30000 },
      cache: { enabled: true, ttl: 60000, maxSize: 1000, maxMemory: 104857600 },
    };

    function createStatOps(
      owner: string,
      entries: Array<{ path: string; sha: string; size: number }>,
      cache: FileCache,
    ): GitHubStatOperations {
      return new GitHubStatOperations(
        { ...baseConfig, owner, repo: "site" } as never,
        {
          getTree: () =>
            Promise.resolve({
              tree: entries.map((entry) => ({ ...entry, type: "blob" })),
              truncated: false,
            }),
          repoId: `${owner}/site`,
        } as never,
        cache,
      );
    }

    // One process-wide cache, as a distributed backend would be.
    const cache = new FileCache();
    const first = createStatOps("owner-a", [
      { path: "pages/shared.tsx", sha: "a-shared", size: 1 },
      { path: "pages/about.tsx", sha: "a-about", size: 1 },
    ], cache);
    const second = createStatOps("owner-b", [
      { path: "pages/shared.tsx", sha: "b-shared", size: 2 },
      { path: "pages/about.mdx", sha: "b-about", size: 2 },
    ], cache);

    await first.buildIndex();
    await second.buildIndex();

    assertEquals(
      (await first.stat("pages/shared.tsx")).size,
      1,
      "the first repository must stat its own file",
    );
    assertEquals(
      (await second.stat("pages/shared.tsx")).size,
      2,
      "a second repository on the same ref must not serve the first repository's stat entry",
    );

    assertEquals(
      await first.resolveFile("about"),
      "pages/about.tsx",
      "the first repository must resolve its own page",
    );
    assertEquals(
      await second.resolveFile("about"),
      "pages/about.mdx",
      "a second repository on the same ref must not serve the first repository's resolved path",
    );
  });
});
