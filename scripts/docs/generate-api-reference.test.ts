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
      const chatReference = await Deno.readTextFile(
        `${outputDir}/veryfront/chat.md`,
      );
      const agentReference = await Deno.readTextFile(
        `${outputDir}/veryfront/agent.md`,
      );
      const mcpReference = await Deno.readTextFile(
        `${outputDir}/veryfront/mcp.md`,
      );
      const providerReference = await Deno.readTextFile(
        `${outputDir}/veryfront/provider.md`,
      );
      const providerTypes = await Deno.readTextFile("src/provider/types.ts");
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
        uiReference,
        'import type { DisclosureParts, DisclosureProps, MultipleToggleGroupRootProps } from "veryfront/ui/adapter";',
        "type-only deep exports must use a copyable type import",
      );
      for (
        const exportName of [
          "ChatInputSend",
          "ChatInputStop",
          "ChatInputVoice",
        ]
      ) {
        assertEquals(
          chatReference.match(
            new RegExp("^\\| `" + exportName + "` \\|", "gm"),
          )?.length,
          1,
          `${exportName} must appear once in the exports table`,
        );
      }
      assertEquals(
        agentReference.match(/^\| `createAgUiHandler` \|/gm)?.length,
        1,
        "createAgUiHandler must appear once in the exports table",
      );
      assertEquals(
        uiReference.match(
          /^\| `ToggleGroupParts` \|[^\n]*data-state="on"\\\|"off"[^\n]*\|/gm,
        )?.length,
        2,
        "ToggleGroupParts descriptions must escape table delimiters",
      );
      assertStringIncludes(
        mcpReference,
        "| `formatSSEPrimingEvent` | Format an SSE priming event. |",
      );
      assertStringIncludes(
        routerReference,
        "| Name | Description | Source |",
      );
      assertStringIncludes(
        providerReference,
        "| `RuntimeMetadata` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L1) |",
        "first-line declarations must keep a source anchor",
      );
      const providerComponents = markdownSection(providerReference, "Components");
      const providerConstants = markdownSection(providerReference, "Constants");
      for (
        const constantName of [
          "DEFAULT_VERYFRONT_CLOUD_MODEL_ID",
          "VERYFRONT_CLOUD_CHAT_MODELS",
          "VERYFRONT_CLOUD_MODEL_PREFIX",
        ]
      ) {
        assertEquals(
          providerComponents.includes(`\`${constantName}\``),
          false,
          `${constantName} must not be classified as a component`,
        );
        assertStringIncludes(
          providerConstants,
          `\`${constantName}\``,
          `${constantName} must be classified as a constant`,
        );
      }
      const generateResultIndex = providerTypes.split("\n").findIndex((line) =>
        line.startsWith("export interface ModelRuntimeGenerateResult")
      );
      assertEquals(
        generateResultIndex >= 0,
        true,
        "test declaration must exist",
      );
      assertStringIncludes(
        providerReference,
        `| \`ModelRuntimeGenerateResult\` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L${
          generateResultIndex + 1
        }) |`,
        "Deno's one-based locations must stay one-based in GitHub anchors",
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

      const middlewareReference = await Deno.readTextFile(
        `${outputDir}/veryfront/middleware.md`,
      );
      assertStringIncludes(
        middlewareReference,
        "Register a cleanup callback that runs once per request after each `execute()`/`handle()` response body closes, is canceled, or errors.",
      );
      assertStringIncludes(
        middlewareReference,
        "Bodyless, locked, or already-read responses and handler/middleware exceptions clean up before the call resolves.",
      );
      assertStringIncludes(
        middlewareReference,
        "Drain and discard all registered teardown callbacks. Unlike the per-request cleanup run by `execute()` / `handle()`, this clears callbacks so they never run again.",
      );
      assertEquals(
        middlewareReference.includes("after the response is sent"),
        false,
        "generated middleware docs must not use the old one-shot teardown timing",
      );
      assertEquals(
        middlewareReference.includes("Run all registered teardown callbacks"),
        false,
        "generated middleware docs must not describe teardown as the per-request cleanup path",
      );
      assertEquals(
        middlewareReference.includes("produces its response"),
        false,
        "generated middleware docs must not describe cleanup as response-production timing",
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

function markdownSection(markdown: string, heading: string): string {
  const startMarker = `### ${heading}\n`;
  const start = markdown.indexOf(startMarker);
  if (start < 0) return "";
  const contentStart = start + startMarker.length;
  const nextHeading = markdown.indexOf("\n### ", contentStart);
  return markdown.slice(contentStart, nextHeading < 0 ? undefined : nextHeading);
}
