import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildGitHubCacheRef } from "./cache-scope.ts";

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
});
