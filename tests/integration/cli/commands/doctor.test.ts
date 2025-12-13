import { assert } from "std/assert/assert.ts";
import { join } from "std/path/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { doctorCommand } from "../../../../src/cli/commands/doctor/index.ts";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";

describe("CLI doctor command", () => {
  it("runs without throwing", async () => {
    await withTestContext("cli-doctor", async (context: TestContext) => {
      await Deno.remove(join(context.projectDir, "app"), { recursive: true });

      await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Hello");
      await doctorCommand(context.projectDir);
      assert(true);
    });
  });
});
