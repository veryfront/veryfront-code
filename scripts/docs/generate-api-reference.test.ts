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
      assertStringIncludes(
        new TextDecoder().decode(result.stdout),
        "Source JSDoc coverage:",
      );

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

      for await (const entry of Deno.readDir(`${outputDir}/veryfront`)) {
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;
        const markdown = await Deno.readTextFile(
          `${outputDir}/veryfront/${entry.name}`,
        );
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
