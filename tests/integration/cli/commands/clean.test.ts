import { assert } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { describe, it } from "#veryfront/testing/bdd";
import { mkdir, writeTextFile } from "#veryfront/compat/fs.ts";
import { setEnv } from "#veryfront/compat/process.ts";
import { cleanCommand } from "../../../../src/cli/commands/clean/index.ts";
import { withTestContext } from "../../../_helpers/context.ts";

describe("CLI clean command", () => {
  it("runs without throwing", { sanitizeOps: false, sanitizeResources: false }, async () => {
    await withTestContext("cli-clean", async (context) => {
      setEnv("VF_CACHE_ALLOW_CLOSE", "1");

      await mkdir(join(context.projectDir, "dist"));
      await writeTextFile(join(context.projectDir, "dist", "file.txt"), "data");

      await cleanCommand({ projectDir: context.projectDir, all: true, force: true });

      assert(true);
    });
  });
});
