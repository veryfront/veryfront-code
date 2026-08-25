import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "veryfront/errors";
import { generateCommand } from "../../../../../cli/commands/generate/index.ts";
import { withTestContext } from "../../../../_helpers/context.ts";

describe("generateCommand conflicts", () => {
  it("refuses to overwrite an existing file with an already-exists error", async () => {
    await withTestContext("generate-conflict", async ({ projectDir }) => {
      await generateCommand(projectDir, "tool", "calculator");

      const error = await assertRejects(() => generateCommand(projectDir, "tool", "calculator"));

      assertEquals(error instanceof VeryfrontError, true);
      assertEquals((error as VeryfrontError).slug, "already-exists");
      assertEquals((error as VeryfrontError).exitCode, 1);
      assertEquals((error as VeryfrontError).detail?.includes("tools/calculator.ts"), true);
    });
  });
});
