import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for analyze-chunks command
 */

import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { cliLogger } from "#cli/utils";
import { analyzeChunksCommand, type AnalyzeChunksOptions } from "./index.ts";

describe("analyze-chunks command", () => {
  describe("analyzeChunksCommand", () => {
    it("is a function", () => {
      assertEquals(typeof analyzeChunksCommand, "function");
    });

    it("accepts options with projectDir", () => {
      assertEquals(analyzeChunksCommand.length, 1);
    });

    it("AnalyzeChunksOptions interface has expected shape", () => {
      const options: AnalyzeChunksOptions = {
        projectDir: "/test/project",
        output: "analysis.json",
      };

      assertEquals(options.projectDir, "/test/project");
      assertEquals(options.output, "analysis.json");
    });

    it("reports analysis errors before exiting", async () => {
      const projectDir = await Deno.makeTempDir();
      const originalExit = Deno.exit;
      const originalError = cliLogger.error;
      const output: string[] = [];
      try {
        await Deno.mkdir(`${projectDir}/pages`);
        await Deno.writeTextFile(
          `${projectDir}/pages/index.mdx`,
          'import broken from "\\xZZ";\n',
        );
        Deno.exit = ((code?: number): never => {
          throw new Error(`Deno.exit(${code ?? 0})`);
        }) as typeof Deno.exit;
        cliLogger.error = (...args: unknown[]) => {
          output.push(args.map(String).join(" "));
        };

        await assertRejects(
          () => analyzeChunksCommand({ projectDir }),
          Error,
          "Deno.exit(1)",
        );
      } finally {
        Deno.exit = originalExit;
        cliLogger.error = originalError;
        await Deno.remove(projectDir, { recursive: true });
      }

      assertEquals(output.length, 1);
      assertStringIncludes(output[0]!, "Failed to analyze chunks");
      assertStringIncludes(output[0]!, "escaped module specifier");
    });
  });
});
