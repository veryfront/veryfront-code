import { assertRejects } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { writeTextFile } from "@veryfront/compat/fs.ts";
import { buildCommand } from "../../../src/cli/commands/build.ts";
import { withTestContext } from "../../_helpers/context.ts";

describe("cli build", () => {
  it("exits with error on invalid config when main", async () => {
    await withTestContext("build-invalid-config", async (context) => {
      // Simulate invalid config by creating a project with malformed cors origin
      await writeTextFile(
        `${context.projectDir}/veryfront.config.js`,
        `export default { security: { cors: { origin: 123 } } };`,
      );
      // When not import.meta.main, buildCommand throws but does not exit
      await assertRejects(() =>
        buildCommand({ projectDir: context.projectDir, dryRun: true } as any)
      );
    });
  });
});
