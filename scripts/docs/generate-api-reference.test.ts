import { assertEquals, assertStringIncludes } from "#std/assert";
import { describe, it } from "#std/testing/bdd";

describe("generate-api-reference", () => {
  it("documents alias re-exports from Deno doc reference declarations", async () => {
    const outputDir = await Deno.makeTempDir();
    try {
      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-read",
          "--allow-write",
          "--allow-run",
          "--allow-env",
          "scripts/docs/generate-api-reference.ts",
          "--output",
          outputDir,
        ],
        stdout: "piped",
        stderr: "piped",
      });

      const result = await command.output();
      assertEquals(
        result.code,
        0,
        new TextDecoder().decode(result.stderr),
      );
      const stdout = new TextDecoder().decode(result.stdout);
      assertStringIncludes(stdout, "Source JSDoc coverage:");
      // The generator reports "(N missing)." — assert the line is present and
      // parses, without pinning the count (current main has 9 known gaps).
      const missingMatch = stdout.match(/\((\d+) missing\)\./);
      assertEquals(missingMatch !== null, true, "missing-count line should be present");

      const routerReference = await Deno.readTextFile(
        `${outputDir}/veryfront/router.md`,
      );
      assertStringIncludes(
        routerReference,
        "| Name | Description | Source |",
      );
      assertStringIncludes(
        routerReference,
        "| `RouterProvider` | Provides the router context value used by `useRouter()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L",
      );
      assertStringIncludes(
        routerReference,
        "| `useRouter` | Reads the current router context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L",
      );

      const localHomePrefix = "/" + "Users/";
      assertEquals(
        routerReference.includes(localHomePrefix),
        false,
        "generated source links must not expose local filesystem paths",
      );

      const serverReference = await Deno.readTextFile(
        `${outputDir}/veryfront/server.md`,
      );
      assertEquals(
        serverReference.match(/### Composable service server/g)?.length,
        1,
        "barrel examples must be rendered once",
      );

      const cliReference = await Deno.readTextFile(
        `${outputDir}/veryfront/cli.md`,
      );
      assertEquals(
        cliReference.includes("`getArgs`"),
        false,
        "generated reference pages must not include private declarations",
      );
      assertStringIncludes(
        cliReference,
        "## Commands",
      );
      assertStringIncludes(
        cliReference,
        "| `veryfront dev` |",
      );
      assertStringIncludes(
        cliReference,
        "| `veryfront mcp` |",
      );
      assertStringIncludes(
        cliReference,
        "### Development",
      );
      assertStringIncludes(
        cliReference,
        "### AI & Automation",
      );

      for await (const entry of Deno.readDir(`${outputDir}/veryfront`)) {
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;
        const markdown = await Deno.readTextFile(
          `${outputDir}/veryfront/${entry.name}`,
        );
        for (const line of markdown.split("\n")) {
          const description = line.match(/^\|\s*`[^`]+`\s*\|\s*([^|]*?)\s*\|/)?.[1] ?? "";
          if (!description) continue;
          for (
            const badPhrase of [
              "Constant for ",
              "Function for ",
              "Handle ",
              "Interface for ",
              "Returns whether ",
              "Type alias for ",
            ]
          ) {
            assertEquals(
              description.includes(badPhrase),
              false,
              `${entry.name} must not contain placeholder JSDoc phrase ${badPhrase}`,
            );
          }
          for (
            const badPhrase of [
              " a feature is enabled",
              " a part carries",
              "ctaprops",
              "internals value",
              "mcpregistry",
              "mcpstats",
              "open ai",
              "otlpwith",
              "rscenabled",
            ]
          ) {
            assertEquals(
              description.toLowerCase().includes(badPhrase),
              false,
              `${entry.name} must not contain placeholder JSDoc phrase ${badPhrase}`,
            );
          }
        }
        assertEquals(
          markdown.includes("#L0"),
          false,
          `${entry.name} must not contain invalid source line anchors`,
        );
      }
    } finally {
      await Deno.remove(outputDir, { recursive: true });
    }
  });
});
