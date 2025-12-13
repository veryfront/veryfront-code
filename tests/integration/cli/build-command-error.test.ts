import { assertRejects } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { buildCommand } from "../../../src/cli/commands/build.ts";
import { withTestContext } from "../../_helpers/context.ts";

describe(
  "cli build",
  
  () => {
    it("exits with error on invalid config when main", async () => {
      await withTestContext("build-invalid-config", async (context) => {
        await Deno.writeTextFile(
          `${context.projectDir}/veryfront.config.js`,
          `export default { security: { cors: { origin: 123 } } };`,
        );
        await assertRejects(() =>
          buildCommand({ projectDir: context.projectDir, dryRun: true } as any)
        );
      });
    });
  },
);
