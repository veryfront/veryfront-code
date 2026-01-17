import { assert } from "@std/assert";
import { join } from "@std/path";
import { describe, it } from "@std/testing/bdd.ts";
import { doctorCommand } from "../../../../src/cli/commands/doctor/index.ts";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";

describe("CLI doctor command", () => {
  it("runs without throwing", async () => {
    await withTestContext("cli-doctor", async (context: TestContext) => {
      // Remove default app directory to use pages router
      await Deno.remove(join(context.projectDir, "app"), { recursive: true });

      // pages directory already exists from TestContext
      await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Hello");
      await doctorCommand(context.projectDir);
      assert(true);
    });
  });
});
