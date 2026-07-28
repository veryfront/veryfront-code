import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getProjectTmpDir, resetGlobalTmpDir } from "./temp-directory.ts";

describe("modules/react-loader/temp-directory", () => {
  it("uses collision-resistant project directory identities", async () => {
    resetGlobalTmpDir();

    // "Aa" and "BB" collide under the previous Java-style 32-bit hash.
    const first = await getProjectTmpDir("Aa");
    const second = await getProjectTmpDir("BB");

    assertNotEquals(first, second);
    assertEquals(await getProjectTmpDir("Aa"), first);
  });

  it("rejects an empty project identity", async () => {
    await assertRejects(
      () => getProjectTmpDir(""),
      RangeError,
      "projectId",
    );
  });
});
