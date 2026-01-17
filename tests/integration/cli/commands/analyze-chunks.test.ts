import { assert } from "@std/assert";
import { describe, it } from "@std/testing/bdd.ts";
import { analyzeChunksCommand } from "../../../../src/cli/commands/analyze-chunks.ts";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";

describe(
  "CLI analyze-chunks",
  () => {
    it("runs without throwing", async () => {
      await withTestContext("analyze-chunks", async (context: TestContext) => {
        await analyzeChunksCommand({ projectDir: context.projectDir });
        assert(true);
      });
    });
  },
);
