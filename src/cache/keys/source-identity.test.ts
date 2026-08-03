import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
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
  });
});
