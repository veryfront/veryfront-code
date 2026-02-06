import { assert } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { analyzeChunksCommand } from "../../../../cli/commands/analyze-chunks/index.ts";
import { withTestContext } from "../../../_helpers/context.ts";

describe("CLI analyze-chunks", () => {
  it("runs without throwing", async () => {
    await withTestContext("analyze-chunks", async (context) => {
      await analyzeChunksCommand({ projectDir: context.projectDir });
      assert(true);
    });
  });
});
