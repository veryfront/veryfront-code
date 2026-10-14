import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { runKnowledgeParser } from "../../../../../../cli/commands/knowledge/parser.ts";

describe("knowledge parser cancellation", () => {
  it("forwards signal and refuses late extraction output after abort", async () => {
    const directory = await makeTempDir();
    const filePath = `${directory}/report.pdf`;
    const outputDir = `${directory}/output`;
    await Deno.writeTextFile(filePath, "%PDF-1.4");
    const controller = new AbortController();
    const reason = new Error("cancel parser before output");
    let observed: AbortSignal | undefined;
    let rejected: unknown;
    try {
      try {
        await runKnowledgeParser({ filePath, outputDir }, {
          signal: controller.signal,
          extractDocumentText: async (input) => {
            observed = input.signal;
            controller.abort(reason);
            return "late extraction output";
          },
        });
      } catch (error) {
        rejected = error;
      }
      assertEquals(observed, controller.signal);
      assertEquals(rejected, reason);
      const outputs = [];
      for await (const output of Deno.readDir(outputDir)) outputs.push(output.name);
      assertEquals(outputs, []);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });
});
