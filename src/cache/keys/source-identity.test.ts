import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { encodeCacheSourceIdentity } from "./source-identity.ts";

describe("cache source identity", () => {
  it("encodes every variable segment without delimiter collisions", () => {
    assertEquals(
      encodeCacheSourceIdentity({ type: "branch", branch: "feature/integrations" }),
      {
        type: "branch",
        qualifier: "feature%2Fintegrations",
        key: "branch:feature%2Fintegrations",
      },
    );
    assertEquals(
      encodeCacheSourceIdentity({
        type: "environment",
        environmentName: "Production:EU",
        releaseId: "release:1",
      }),
      {
        type: "environment",
        qualifier: "Production%3AEU:release%3A1",
        key: "environment:Production%3AEU:release%3A1",
      },
    );
    assertEquals(
      encodeCacheSourceIdentity({ type: "release", releaseId: "release:1" }),
      {
        type: "release",
        qualifier: "release%3A1",
        key: "release:release%3A1",
      },
      "release ids must be percent-encoded so delimiters cannot leak into the key",
    );
  });

  it("keeps identities distinct when raw delimiters move between fields", () => {
    const left = encodeCacheSourceIdentity({
      type: "environment",
      environmentName: "Production:release-1",
      releaseId: "release-2",
    });
    const right = encodeCacheSourceIdentity({
      type: "environment",
      environmentName: "Production",
      releaseId: "release-1:release-2",
    });

    assertNotEquals(left.key, right.key);
    assertNotEquals(
      encodeCacheSourceIdentity({ type: "release", releaseId: "a:b" }).key,
      encodeCacheSourceIdentity({ type: "release", releaseId: "a" }).key + ":b",
      "a colon inside a release id must not alias a release plus a path segment",
    );
  });

  it("refuses an identity with a missing variable segment", () => {
    assertThrows(
      () =>
        encodeCacheSourceIdentity({
          type: "environment",
          environmentName: "",
          releaseId: "r",
        }),
      Error,
      "Missing environmentName",
      "an empty environment name must be an invariant violation, not a shared cache prefix",
    );
    assertThrows(
      () =>
        encodeCacheSourceIdentity({
          type: "environment",
          environmentName: "Production",
          releaseId: "",
        }),
      Error,
      "Missing releaseId",
      "an empty release id must be an invariant violation, not a shared cache prefix",
    );
    assertThrows(
      () => encodeCacheSourceIdentity({ type: "release", releaseId: "" }),
      Error,
      "Missing releaseId",
      "an empty release id must be an invariant violation, not a shared cache prefix",
    );
    assertThrows(
      () => encodeCacheSourceIdentity({ type: "branch", branch: "" }),
      Error,
      "Missing branch",
      "an empty branch must be an invariant violation, not a shared cache prefix",
    );
  });
});
