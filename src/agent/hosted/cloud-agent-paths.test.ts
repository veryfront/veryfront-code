import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/platform/compat/path/index.ts";
import { resolveProjectDir } from "./cloud-agent-paths.ts";

describe("cloud-agent-paths", () => {
  it("discovers an ancestor project with an MJS-only config", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-cloud-agent-paths-" });
    const nestedDir = join(projectDir, "src", "agent");

    try {
      await Deno.mkdir(nestedDir, { recursive: true });
      await Deno.writeTextFile(
        join(projectDir, "veryfront.config.mjs"),
        "export default {};\n",
      );

      assertEquals(resolveProjectDir({ baseDir: nestedDir }), projectDir);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});
