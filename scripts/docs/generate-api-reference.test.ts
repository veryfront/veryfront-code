import {
  assertEquals,
  assertMatch,
  assertRejects,
  assertStringIncludes,
} from "#std/assert";
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
      await assertRejects(
        () => Deno.readTextFile(`${outputDir}/veryfront/index.client.md`),
        Deno.errors.NotFound,
      );
      const uiReference = await Deno.readTextFile(
        `${outputDir}/veryfront/ui.md`,
      );
      const chatReference = await Deno.readTextFile(
        `${outputDir}/veryfront/chat.md`,
      );
      const providerReference = await Deno.readTextFile(
        `${outputDir}/veryfront/provider.md`,
      );
      const skillReference = await Deno.readTextFile(
        `${outputDir}/veryfront/skill.md`,
      );
      const agentReference = await Deno.readTextFile(
        `${outputDir}/veryfront/agent.md`,
      );
      const channelsReference = await Deno.readTextFile(
        `${outputDir}/veryfront/channels.md`,
      );
      const providerTypesSource = await Deno.readTextFile(
        new URL("../../src/provider/types.ts", import.meta.url),
      );
      const runtimeMetadataLine = findSourceLine(
        providerTypesSource,
        "export interface RuntimeMetadata",
      );
      const modelRuntimeGenerateResultLine = findSourceLine(
        providerTypesSource,
        "export interface ModelRuntimeGenerateResult",
      );
      assertEquals(
        rootReference.includes(
          "\nConfiguration, server bootstrap, routing, data fetching, and input validation.\n\n## Import",
        ),
        false,
        "generated reference pages must not duplicate the frontmatter description as body copy",
      );
      assertStringIncludes(
        uiReference,
        "| `AppShellProps` | Props accepted by `AppShell`. |",
      );
      const chatComponents = chatReference
        .split("### Components\n", 2)[1]
        ?.split("\n### ", 1)[0] ?? "";
      const chatConstants = chatReference
        .split("### Constants\n", 2)[1]
        ?.split("\n### ", 1)[0] ?? "";
      assertEquals(
        chatComponents.includes("CONVERSATION_STORAGE_LIMITS"),
        false,
        "all-caps variables must not be classified as React components",
      );
      assertStringIncludes(
        chatConstants,
        "`CONVERSATION_STORAGE_LIMITS`",
      );
      assertStringIncludes(
        chatReference,
        "### `ConversationStorageLimits`",
      );
      assertStringIncludes(
        chatReference,
        "### `ConversationStoreError`",
      );
      assertStringIncludes(
        chatReference,
        "### `ConversationStoreOperation`",
      );
      assertStringIncludes(
        chatReference,
        '`"list" \\| "load" \\| "save" \\| "delete" \\| "subscribe"`',
      );
      assertStringIncludes(
        routerReference,
        "| Name | Description | Source |",
      );
      assertStringIncludes(
        providerReference,
        `| \`RuntimeMetadata\` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L${runtimeMetadataLine}) |`,
        "first-line declarations must keep a source anchor",
      );
      assertStringIncludes(
        providerReference,
        `| \`ModelRuntimeGenerateResult\` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L${modelRuntimeGenerateResultLine}) |`,
        "generated source anchors must match the declaration's current source line",
      );
      assertStringIncludes(
        channelsReference,
        "`veryfront/channels/control-plane`",
      );
      assertStringIncludes(
        channelsReference,
        "`veryfront/channels/invoke`",
      );
      assertStringIncludes(
        channelsReference,
        "`verifyControlPlaneJwsSignature`",
      );
      assertStringIncludes(
        channelsReference,
        "`ExecuteChannelInvokeOptions`",
      );
      const skillImportBlock = skillReference
        .split("## Import\n", 2)[1]
        ?.split("\n## ", 1)[0] ?? "";
      assertEquals(
        skillImportBlock.includes("buildUnsafeLegacySkillManifestPrompt"),
        false,
        "deprecated compatibility helpers must not appear in recommended imports",
      );
      assertStringIncludes(
        skillReference,
        "| `buildUnsafeLegacySkillManifestPrompt` | **Deprecated:**",
      );
      assertStringIncludes(
        skillReference,
        "Use `buildSkillManifestPrompt`.",
      );
      assertStringIncludes(
        agentReference,
        "| `buildUnsafeLegacyRuntimeSkillDefinition` | **Deprecated:**",
      );
      assertStringIncludes(
        agentReference,
        "Use `buildRuntimeSkillDefinition`.",
      );
      assertStringIncludes(
        agentReference,
        "| `buildUnsafeLegacyRuntimeLoadedSkillResponse` | **Deprecated:**",
      );
      assertStringIncludes(
        agentReference,
        "Use `buildRuntimeLoadedSkillResponse`.",
      );
      assertStringIncludes(
        agentReference,
        "| `getRuntimeSkillFrontmatterSchema` |",
        "the documented runtime frontmatter replacement must be publicly exported",
      );
      assertStringIncludes(
        agentReference,
        "**Deprecated:** Use `getRuntimeSkillFrontmatterSchema`.",
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

      assertStringIncludes(
        middlewareReference,
        "### `middlewarePipeline.useFor(pattern, ...handlers)`",
      );
      assertStringIncludes(
        middlewareReference,
        "Unlike `execute`, which returns a 404",
      );
      assertEquals(
        middlewareReference.includes("useFor(pattern, )"),
        false,
        "rest parameters must retain their names in generated method signatures",
      );

      const sandboxReference = await Deno.readTextFile(
        `${outputDir}/veryfront/sandbox.md`,
      );
      for (
        const signature of [
          "Sandbox.create(options)",
          "Sandbox.get(id, options)",
          "Sandbox.list(options)",
          "Sandbox.createLazy(options)",
        ]
      ) {
        assertStringIncludes(
          sandboxReference,
          `### \`${signature}\``,
          `default-valued parameter name must be preserved for ${signature}`,
        );
      }
      for (
        const falseSignature of [
          "Sandbox.create(arg)",
          "Sandbox.get(id, arg)",
          "Sandbox.list(arg)",
          "Sandbox.createLazy(arg)",
          "Sandbox.create()",
          "Sandbox.get(id, )",
          "Sandbox.list()",
          "Sandbox.createLazy()",
        ]
      ) {
        assertEquals(
          sandboxReference.includes(`### \`${falseSignature}\``),
          false,
          `generated docs must not contain false signature ${falseSignature}`,
        );
      }

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
        assertEquals(
          markdown.includes("{@link"),
          false,
          `${entry.name} must not expose raw JSDoc link syntax`,
        );
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

  it("accepts a current generated tree without writing to it in check mode", async () => {
    const outputDir = await Deno.makeTempDir({
      prefix: "veryfront-api-reference-current-",
    });
    try {
      assertGeneratorSuccess(
        await runGenerator(["--output", outputDir]),
      );
      const before = await snapshotDirectory(outputDir);

      const result = await runGenerator(["--check", "--output", outputDir]);

      assertGeneratorSuccess(result);
      assertStringIncludes(
        decode(result.stdout),
        "Generated API reference is current",
      );
      assertEquals(await snapshotDirectory(outputDir), before);
    } finally {
      await Deno.remove(outputDir, { recursive: true });
    }
  });

  it("reports sorted changed, missing, and extra files without repairing them in check mode", async () => {
    const outputDir = await Deno.makeTempDir({
      prefix: "veryfront-api-reference-stale-",
    });
    try {
      await Deno.mkdir(`${outputDir}/veryfront`);
      await Deno.writeTextFile(`${outputDir}/index.md`, "stale index\n");
      await Deno.writeTextFile(
        `${outputDir}/veryfront/extra.md`,
        "extra page\n",
      );
      const before = await snapshotDirectory(outputDir);

      const result = await runGenerator(["--check", "--output", outputDir]);

      assertEquals(result.code, 1, decode(result.stderr));
      const stderr = decode(result.stderr);
      const missingIndex = stderr.indexOf(
        "Missing:\n  - veryfront/agent.md",
      );
      const extraIndex = stderr.indexOf(
        "Extra:\n  - veryfront/extra.md",
      );
      const changedIndex = stderr.indexOf("Changed:\n  - index.md");
      assertEquals(missingIndex >= 0, true, stderr);
      assertEquals(extraIndex > missingIndex, true, stderr);
      assertEquals(changedIndex > extraIndex, true, stderr);
      assertStringIncludes(stderr, "Run `deno task docs` to regenerate.");
      assertEquals(await snapshotDirectory(outputDir), before);
    } finally {
      await Deno.remove(outputDir, { recursive: true });
    }
  });

  it("fails closed with bounded sanitized diagnostics when deno doc exits nonzero", async () => {
    const fakeBinDir = await Deno.makeTempDir({
      prefix: "veryfront-api-reference-fake-deno-",
    });
    const outputDir = await Deno.makeTempDir({
      prefix: "veryfront-api-reference-failed-doc-",
    });
    const argsPath = `${fakeBinDir}/args.txt`;
    try {
      await writeFakeDeno(
        fakeBinDir,
        `printf '%s\\n' "$@" > "$VF_FAKE_DENO_ARGS"\nprintf '%s' "$VF_FAKE_DENO_OUTPUT" >&2\nexit 23`,
      );
      const unsafeContext = `${Deno.cwd()}/private-token\n\x1b[31m${
        "x".repeat(2_048)
      }\x1b[0m`;

      const result = await runGenerator(["--check", "--output", outputDir], {
        PATH: fakeBinDir,
        VF_FAKE_DENO_ARGS: argsPath,
        VF_FAKE_DENO_OUTPUT: unsafeContext,
      });

      assertEquals(result.code, 1, decode(result.stdout));
      const stderr = decode(result.stderr);
      assertStringIncludes(stderr, "ApiReferenceGenerationError");
      assertStringIncludes(stderr, "[DENO_DOC_FAILED]");
      assertStringIncludes(stderr, "./src/index.ts");
      assertStringIncludes(stderr, "exit code 23");
      assertStringIncludes(stderr, "<project-root>/private-token");
      assertEquals(stderr.includes(Deno.cwd()), false);
      assertEquals(stderr.includes("\x1b"), false);
      assertEquals(stderr.includes("x".repeat(600)), false);
      assertEquals(stderr.length < 1_400, true, stderr);
      assertEquals(
        await Deno.readTextFile(argsPath),
        "doc\n--frozen\n--json\nsrc/index.ts\n",
      );
    } finally {
      await Deno.remove(fakeBinDir, { recursive: true });
      await Deno.remove(outputDir, { recursive: true });
    }
  });

  it("fails closed with bounded sanitized diagnostics when deno doc returns malformed JSON", async () => {
    const fakeBinDir = await Deno.makeTempDir({
      prefix: "veryfront-api-reference-fake-deno-",
    });
    const outputDir = await Deno.makeTempDir({
      prefix: "veryfront-api-reference-malformed-doc-",
    });
    try {
      await writeFakeDeno(
        fakeBinDir,
        `printf '%s' "$VF_FAKE_DENO_OUTPUT"\nexit 0`,
      );
      const unsafeOutput = `{not-json:${Deno.cwd()}:\x1b[32m${
        "y".repeat(2_048)
      }`;

      const result = await runGenerator(["--check", "--output", outputDir], {
        PATH: fakeBinDir,
        VF_FAKE_DENO_OUTPUT: unsafeOutput,
      });

      assertEquals(result.code, 1, decode(result.stdout));
      const stderr = decode(result.stderr);
      assertStringIncludes(stderr, "ApiReferenceGenerationError");
      assertStringIncludes(stderr, "[DENO_DOC_INVALID_JSON]");
      assertStringIncludes(stderr, "./src/index.ts");
      assertStringIncludes(stderr, "<project-root>");
      assertEquals(stderr.includes(Deno.cwd()), false);
      assertEquals(stderr.includes("\x1b"), false);
      assertEquals(stderr.includes("y".repeat(600)), false);
      assertEquals(stderr.length < 1_400, true, stderr);
    } finally {
      await Deno.remove(fakeBinDir, { recursive: true });
      await Deno.remove(outputDir, { recursive: true });
    }
  });

  it("wires generated API reference drift into docs validation", async () => {
    const config = JSON.parse(await Deno.readTextFile("deno.json")) as {
      readonly tasks?: Record<string, string>;
    };
    const checkTask = config.tasks?.["docs:generated:check"] ?? "";
    const validateTask = config.tasks?.["docs:validate"] ?? "";

    assertStringIncludes(checkTask, "generate-api-reference.ts --check");
    assertStringIncludes(checkTask, "--frozen");
    assertStringIncludes(validateTask, "deno task docs:generated:check");
  });
});

interface CommandResult {
  readonly code: number;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
}

interface FileSnapshot {
  readonly content: string;
  readonly modifiedAt: number | null;
}

async function runGenerator(
  args: readonly string[],
  env?: Record<string, string>,
): Promise<CommandResult> {
  return await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--frozen",
      "--allow-read",
      "--allow-write",
      "--allow-run",
      "--allow-env",
      "scripts/docs/generate-api-reference.ts",
      ...args,
    ],
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
}

function assertGeneratorSuccess(result: CommandResult): void {
  assertEquals(result.code, 0, decode(result.stderr));
}

async function writeFakeDeno(
  directory: string,
  body: string,
): Promise<void> {
  const path = `${directory}/deno`;
  await Deno.writeTextFile(path, `#!/bin/sh\nset -eu\n${body}\n`);
  await Deno.chmod(path, 0o700);
}

async function snapshotDirectory(
  root: string,
): Promise<Record<string, FileSnapshot>> {
  const snapshot: Record<string, FileSnapshot> = {};
  await collectDirectorySnapshot(root, "", snapshot);
  return Object.fromEntries(
    Object.entries(snapshot).sort(([left], [right]) =>
      left.localeCompare(right)
    ),
  );
}

async function collectDirectorySnapshot(
  root: string,
  relativeDirectory: string,
  snapshot: Record<string, FileSnapshot>,
): Promise<void> {
  const directory = relativeDirectory ? `${root}/${relativeDirectory}` : root;
  const entries: Deno.DirEntry[] = [];
  for await (const entry of Deno.readDir(directory)) entries.push(entry);
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    if (entry.isDirectory) {
      await collectDirectorySnapshot(root, relativePath, snapshot);
      continue;
    }
    if (!entry.isFile) continue;
    const path = `${root}/${relativePath}`;
    const stat = await Deno.stat(path);
    snapshot[relativePath] = {
      content: await Deno.readTextFile(path),
      modifiedAt: stat.mtime?.getTime() ?? null,
    };
  }
}

function decode(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

function findSourceLine(source: string, declaration: string): number {
  const index = source.split("\n").findIndex((line) =>
    line.startsWith(declaration)
  );
  if (index < 0) {
    throw new Error(`Missing source declaration: ${declaration}`);
  }
  return index + 1;
}
