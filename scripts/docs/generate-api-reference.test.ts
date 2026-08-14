import {
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#std/testing/bdd";
import { compile } from "npm:@mdx-js/mdx@3.1.1";

const CHECK_TEMP_PREFIX = "veryfront-api-reference-check-";

async function listCheckTempDirectories(tempRoot: string): Promise<string[]> {
  const paths: string[] = [];
  for await (const entry of Deno.readDir(tempRoot)) {
    if (entry.isDirectory && entry.name.startsWith(CHECK_TEMP_PREFIX)) {
      paths.push(entry.name);
    }
  }
  return paths.sort();
}

async function runGenerator(outputDir: string): Promise<string> {
  const result = await new Deno.Command(Deno.execPath(), {
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
  }).output();
  assertEquals(
    result.code,
    0,
    new TextDecoder().decode(result.stderr),
  );
  return new TextDecoder().decode(result.stdout);
}

async function readGeneratedReferenceSnapshot(
  outputDir: string,
): Promise<Array<{ path: string; contents: string }>> {
  const paths = ["index.md"];
  for await (const entry of Deno.readDir(`${outputDir}/veryfront`)) {
    if (entry.isFile && entry.name.endsWith(".md")) {
      paths.push(`veryfront/${entry.name}`);
    }
  }
  paths.sort();

  return await Promise.all(
    paths.map(async (path) => ({
      path,
      contents: await Deno.readTextFile(`${outputDir}/${path}`),
    })),
  );
}

async function assertGeneratedReferenceIsFormatted(
  outputDir: string,
): Promise<void> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: [
      "fmt",
      "--check",
      `--config=${Deno.cwd()}/deno.json`,
      `${outputDir}/index.md`,
      `${outputDir}/veryfront`,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(
    result.code,
    0,
    new TextDecoder().decode(result.stderr),
  );
}

describe("generate-api-reference", () => {
  it("removes check output when generation fails", async () => {
    const sandboxRoot = await Deno.makeTempDir();
    const emptyRoot = `${sandboxRoot}/cwd`;
    const tempRoot = `${sandboxRoot}/tmp`;
    await Deno.mkdir(emptyRoot);
    await Deno.mkdir(tempRoot);
    const before = await listCheckTempDirectories(tempRoot);
    try {
      const result = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--allow-all",
          `--config=${Deno.cwd()}/deno.json`,
          `${Deno.cwd()}/scripts/docs/generate-api-reference.ts`,
          "--check",
        ],
        cwd: emptyRoot,
        env: { TMPDIR: tempRoot },
        stdout: "null",
        stderr: "piped",
      }).output();

      assertEquals(
        result.code === 0,
        false,
        "generation should fail without deno.json",
      );
      assertStringIncludes(
        new TextDecoder().decode(result.stderr),
        "deno.json",
      );
      assertEquals(
        await listCheckTempDirectories(tempRoot),
        before,
        "failed check generation must not leak its temporary output",
      );
    } finally {
      await Deno.remove(sandboxRoot, { recursive: true });
    }
  });

  it("documents alias re-exports from Deno doc reference declarations", async () => {
    const outputDir = await Deno.makeTempDir();
    try {
      const stdout = await runGenerator(outputDir);
      assertStringIncludes(stdout, "Source JSDoc coverage:");
      // The generator reports "(N missing)." — assert the line is present and
      // parses, without pinning the count (current main has 9 known gaps).
      const missingMatch = stdout.match(/\((\d+) missing\)\./);
      assertEquals(
        missingMatch !== null,
        true,
        "missing-count line should be present",
      );
      const firstSnapshot = await readGeneratedReferenceSnapshot(outputDir);
      await runGenerator(outputDir);
      assertEquals(
        await readGeneratedReferenceSnapshot(outputDir),
        firstSnapshot,
        "two consecutive generations must produce byte-identical references",
      );
      await assertGeneratedReferenceIsFormatted(outputDir);

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
      assertMatch(
        uiReference,
        /^\|\s*`AppShellProps`\s*\|\s*Props accepted by `AppShell`\.\s*\|/m,
      );
      assertMatch(
        uiReference,
        /import type \{\s*DisclosureParts,\s*DisclosureProps,\s*MultipleToggleGroupRootProps,?\s*\} from "veryfront\/ui\/adapter";/m,
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
            new RegExp("^\\|\\s*`" + exportName + "`\\s*\\|", "gm"),
          )?.length,
          1,
          `${exportName} must appear once in the exports table`,
        );
      }
      assertEquals(
        agentReference.match(/^\|\s*`createAgUiHandler`\s*\|/gm)?.length,
        1,
        "createAgUiHandler must appear once in the exports table",
      );
      assertEquals(
        uiReference.match(
          /^\|\s*`ToggleGroupParts`\s*\|[^\n]*data-state="on"\\\|"off"[^\n]*\|/gm,
        )?.length,
        2,
        "ToggleGroupParts descriptions must escape table delimiters",
      );
      assertMatch(
        mcpReference,
        /^\|\s*`formatSSEPrimingEvent`\s*\|\s*Format an SSE priming event\.\s*\|/m,
      );
      assertMatch(
        routerReference,
        /^\|\s*Name\s*\|\s*Description\s*\|\s*Source\s*\|$/m,
      );
      assertMatch(
        providerReference,
        /^\|\s*`RuntimeMetadata`\s*\|\s*\|\s*\[source\]\(https:\/\/github\.com\/veryfront\/veryfront-code\/blob\/main\/src\/provider\/types\.ts#L1\)\s*\|$/m,
        "first-line declarations must keep a source anchor",
      );
      const generateResultIndex = providerTypes.split("\n").findIndex((line) =>
        line.startsWith("export interface ModelRuntimeGenerateResult")
      );
      assertEquals(
        generateResultIndex >= 0,
        true,
        "test declaration must exist",
      );
      assertMatch(
        providerReference,
        new RegExp(
          `^\\|\\s*\`ModelRuntimeGenerateResult\`\\s*\\|\\s*\\|\\s*\\[source\\]\\(https:\\/\\/github\\.com\\/veryfront\\/veryfront-code\\/blob\\/main\\/src\\/provider\\/types\\.ts#L${
            generateResultIndex + 1
          }\\)\\s*\\|$`,
          "m",
        ),
        "Deno's one-based locations must stay one-based in GitHub anchors",
      );
      // Alias re-exports must resolve to their target's JSDoc description and a
      // source link. Assert the stable leading phrase + link rather than pinning
      // the full prose, which evolves with the JSDoc.
      assertMatch(
        routerReference,
        /^\|\s*`RouterProvider`\s*\|\s*Provides the router context[^|]*\|\s*\[source\]\(https:\/\/github\.com\/veryfront\/veryfront-code\/blob\/main\/src\/react\/runtime\/core\.ts#L\d+\)/m,
      );
      assertMatch(
        routerReference,
        /^\|\s*`RouterProvider`\s*\|\s*Provides the router context\. `pathname`\/`query` track the live URL through the shared navigation store's `useSyncExternalStore` surface;/m,
      );
      assertMatch(
        routerReference,
        /^\|\s*`useRouter`\s*\|\s*Reads the router context[^|]*\|\s*\[source\]\(https:\/\/github\.com\/veryfront\/veryfront-code\/blob\/main\/src\/react\/runtime\/core\.ts#L\d+\)/m,
      );
      assertMatch(
        routerReference,
        /^\|\s*`useRouter`\s*\|\s*Reads the router context: `pathname`, `query`, `params`, and the navigation actions\./m,
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
      assertStringIncludes(
        middlewareReference,
        "### `MemoryRateLimitStoreOptions`",
        "generated middleware reference must retain the public memory-store options table",
      );
      const memoryStoreSectionStart = middlewareReference.indexOf(
        "### `MemoryRateLimitStoreOptions`",
      );
      const memoryStoreSectionEnd = middlewareReference.indexOf(
        "\n### ",
        memoryStoreSectionStart + 1,
      );
      const memoryStoreSection = middlewareReference.slice(
        memoryStoreSectionStart,
        memoryStoreSectionEnd === -1 ? undefined : memoryStoreSectionEnd,
      );
      assertStringIncludes(
        memoryStoreSection,
        "`maxEntries?`",
        "generated memory-store capacity documentation must retain the maxEntries option row",
      );
      assertMatch(
        memoryStoreSection,
        /\[source\]\([^\n)]*src\/middleware\/builtin\/security\/rate-limit\.ts#L\d+\)/,
        "generated memory-store capacity documentation must retain its source link",
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
      assertMatch(
        cliReference,
        /^\|\s*`veryfront dev`\s*\|/m,
      );
      assertMatch(
        cliReference,
        /^\|\s*`veryfront mcp`\s*\|/m,
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
