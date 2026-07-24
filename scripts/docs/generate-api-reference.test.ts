import { assertEquals, assertMatch, assertStringIncludes } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { compile } from "npm:@mdx-js/mdx@3.1.1";

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
      assertEquals(
        missingMatch !== null,
        true,
        "missing-count line should be present",
      );

      const routerReference = await Deno.readTextFile(
        `${outputDir}/veryfront/router.md`,
      );
      const rootReference = await Deno.readTextFile(
        `${outputDir}/veryfront/index.md`,
      );
      const clientReference = await Deno.readTextFile(
        `${outputDir}/veryfront/index.client.md`,
      );
      const uiReference = await Deno.readTextFile(
        `${outputDir}/veryfront/ui.md`,
      );
      assertEquals(
        rootReference.includes(
          "\nConfiguration, server bootstrap, routing, data fetching, and input validation.\n\n## Import",
        ),
        false,
        "generated reference pages must not duplicate the frontmatter description as body copy",
      );
      assertEquals(
        clientReference.includes("#veryfront/"),
        false,
        "generated client reference must not expose internal import specifiers",
      );
      assertStringIncludes(
        uiReference,
        "| `AppShellProps` | Props accepted by `AppShell`. |",
      );
      assertStringIncludes(
        routerReference,
        "| Name | Description | Source |",
      );
      // Alias re-exports must resolve to their target's JSDoc description and a
      // source link. Assert the stable leading phrase + link rather than pinning
      // the full prose, which evolves with the JSDoc.
      assertMatch(
        routerReference,
        /\| `RouterProvider` \| Provides the router context[^|]*\| \[source\]\(https:\/\/github\.com\/veryfront\/veryfront-code\/blob\/main\/src\/react\/runtime\/core\.ts#L\d+\)/,
      );
      assertStringIncludes(
        routerReference,
        "| `RouterProvider` | Provides the router context. `pathname`/`query` track the live URL through the shared navigation store's `useSyncExternalStore` surface;",
      );
      assertMatch(
        routerReference,
        /\| `useRouter` \| Reads the router context[^|]*\| \[source\]\(https:\/\/github\.com\/veryfront\/veryfront-code\/blob\/main\/src\/react\/runtime\/core\.ts#L\d+\)/,
      );
      assertStringIncludes(
        routerReference,
        "| `useRouter` | Reads the router context: `pathname`, `query`, `params`, and the navigation actions.",
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
        try {
          await compile(markdown);
        } catch (error) {
          throw new Error(`${entry.name} must compile as MDX`, {
            cause: error,
          });
        }
        for (const line of markdown.split("\n")) {
          const description =
            line.match(/^\|\s*`[^`]+`\s*\|\s*([^|]*?)\s*\|/)?.[1] ?? "";
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
        assertEquals(
          markdown.includes("{@"),
          false,
          `${entry.name} must not contain raw inline JSDoc tags`,
        );
      }
    } finally {
      await Deno.remove(outputDir, { recursive: true });
    }
  });
});
