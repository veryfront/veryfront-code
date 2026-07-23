import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { remove } from "#veryfront/testing/deno-compat.ts";
import { getProjectTmpDir, resetGlobalTmpDir } from "./temp-directory.ts";

describe("modules/react-loader/temp-directory", () => {
  it("uses collision-resistant project directory identities", async () => {
    resetGlobalTmpDir();
    const first = await getProjectTmpDir("Aa");
    const second = await getProjectTmpDir("BB");

    try {
      assertEquals(first === second, false);
    } finally {
      await remove(first, { recursive: true }).catch(() => {});
      await remove(second, { recursive: true }).catch(() => {});
      resetGlobalTmpDir();
    }
  });

  it("rejects invalid project identities", async () => {
    for (const projectId of ["", "invalid\u0000project"]) {
      await assertRejects(
        () => getProjectTmpDir(projectId),
        TypeError,
        "projectId is invalid",
      );
    }
  });
});
