import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { VeryfrontError } from "veryfront/errors";
import { writeTextFile } from "#veryfront/compat/fs.ts";
import { buildCommand } from "./command.ts";
import { withTestContext } from "../../../tests/_helpers/context.ts";

describe("cli build", () => {
  it("exits with error on invalid config when main", async () => {
    await withTestContext("build-invalid-config", async (context) => {
      await writeTextFile(
        `${context.projectDir}/veryfront.config.js`,
        `export default { security: { cors: { origin: 123 } } };`,
      );

      const error = await assertRejects(() =>
        buildCommand({ projectDir: context.projectDir, dryRun: true } as any)
      );

      assertEquals(error instanceof VeryfrontError, true);
      assertEquals((error as VeryfrontError).slug, "config-validation-failed");
      assertEquals(
        error.message.includes("Invalid veryfront.config at security.cors"),
        true,
      );
    });
  });
});
