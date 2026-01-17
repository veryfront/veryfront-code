import { assert } from "@std/assert";
import { join } from "@std/path";
import { describe, it } from "@std/testing/bdd.ts";
import { cleanCommand } from "../../../../src/cli/commands/clean.ts";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";

describe("CLI clean command", () => {
  it("runs without throwing", { sanitizeOps: false, sanitizeResources: false }, async () => {
    await withTestContext("cli-clean", async (context: TestContext) => {
      Deno.env.set("VF_CACHE_ALLOW_CLOSE", "1");
      // create fake dist
      await Deno.mkdir(join(context.projectDir, "dist"));
      await Deno.writeTextFile(join(context.projectDir, "dist", "file.txt"), "data");
      await cleanCommand({ projectDir: context.projectDir, all: true });
      // Cache cleanup happens automatically in cleanCommand
      assert(true);
    });
  });
});
