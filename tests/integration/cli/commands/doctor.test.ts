import { assert } from "@veryfront/testing/assert";
import { join } from "@veryfront/compat/path";
import { describe, it } from "@veryfront/testing/bdd";
import { remove, writeTextFile } from "@veryfront/compat/fs.ts";
import { doctorCommand } from "../../../../src/cli/commands/doctor/index.ts";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";

describe("CLI doctor command", () => {
  it("runs without throwing", async () => {
    await withTestContext("cli-doctor", async (context: TestContext) => {
      // Remove default app directory to use pages router
      await remove(join(context.projectDir, "app"), { recursive: true });

      // pages directory already exists from TestContext
      await writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Hello");
      await doctorCommand(context.projectDir);
      assert(true);
    });
  });
});
