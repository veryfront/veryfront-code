#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env
/**
 * Compile and statically check the runnable integration guide snippets.
 *
 * - `ts` fences: `deno check` against this checkout's public exports.
 * - `bash` fences: `bash -n`, no unquoted `<PLACEHOLDER>` tokens, and every
 *   `<<'GRAPHQL'` document validated against the checked-in schema snapshot.
 * - The integrations guide's TypeScript first-call script: run under Node in a
 *   clean directory set up with the guide's own commands, against a local
 *   `veryfront` package, and again with `type=commonjs` in place of
 *   `type=module`, which must fail.
 * - Integration guides, bundled skills and install templates: no
 *   credential-shaped literals and only released `veryfront integration`
 *   subcommands.
 *
 * Usage: deno task docs:snippets:check
 */

import {
  extractFences,
  extractGraphqlHeredocs,
  extractNodeFirstCall,
  findSecretLiterals,
  findUnknownIntegrationSubcommands,
  findUnquotedInlineCommands,
  findUnquotedPlaceholders,
  type GraphqlSchemaSnapshot,
  nodeFirstCallScript,
  nodeStripsTypes,
  parseSubcommandUsage,
  rewritePublicImports,
  validateGraphqlOperation,
} from "./guide-snippets.ts";
import { integrationHelp } from "../../cli/commands/integration/command-help.ts";

const ROOT = new URL("../../", import.meta.url);
const SNIPPET_GUIDES = [
  "docs/guides/connect-runtime.md",
  "docs/guides/integrations.md",
  "docs/guides/integrations/recovery.md",
  "docs/guides/integrations/credentials.md",
];
const GUIDANCE_DIRS = [
  "cli/mcp/skills",
  "templates/ai-rules",
  "docs/guides/integrations",
];
const GRAPHQL_SCHEMA = "scripts/docs/fixtures/integrations-graphql-schema.json";

const issues: string[] = [];
const report = (file: string, line: number, message: string) =>
  issues.push(`${file}:${line}: ${message}`);

async function run(command: string, args: string[], stdin?: string) {
  const child = new Deno.Command(command, {
    args,
    cwd: ROOT,
    stdin: stdin === undefined ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  if (stdin !== undefined) {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(stdin));
    await writer.close();
  }
  const output = await child.output();
  return {
    success: output.success,
    text: new TextDecoder().decode(output.stdout) +
      new TextDecoder().decode(output.stderr),
  };
}

const PACKAGE_REACHED = "veryfront/integrations loaded";
const COMMONJS_IMPORT_ERROR = "Cannot use import statement outside a module";

/**
 * Run the guide's Node setup and the first-call script in a fresh directory.
 * The local `veryfront` package throws PACKAGE_REACHED from
 * `createIntegrationClient`, so reaching it proves the import resolved.
 */
async function runNodeFirstCall(
  guide: string,
  dir: string,
): Promise<string[]> {
  const call = extractNodeFirstCall(
    await Deno.readTextFile(new URL(guide, ROOT)),
  );
  const pkg = `${dir}/veryfront-package`;
  const snippet = `${dir}/first-call-snippet.ts`;
  await Deno.mkdir(pkg, { recursive: true });
  await Deno.writeTextFile(
    `${pkg}/package.json`,
    JSON.stringify({
      name: "veryfront",
      version: "0.0.0",
      type: "module",
      exports: { "./integrations": "./integrations.js" },
    }),
  );
  await Deno.writeTextFile(
    `${pkg}/integrations.js`,
    `export async function createIntegrationClient() {\n  throw new Error(${
      JSON.stringify(PACKAGE_REACHED)
    });\n}\n`,
  );
  await Deno.writeTextFile(snippet, call.script);

  const runIn = async (name: string, commonjs: boolean) => {
    const cwd = `${dir}/${name}`;
    await Deno.mkdir(cwd);
    const child = new Deno.Command("bash", {
      cwd,
      env: { VERYFRONT_PACKAGE: pkg, SNIPPET: snippet },
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const writer = child.stdin.getWriter();
    await writer.write(
      new TextEncoder().encode(nodeFirstCallScript(call, { commonjs })),
    );
    await writer.close();
    const output = await child.output();
    return new TextDecoder().decode(output.stdout) +
      new TextDecoder().decode(output.stderr);
  };

  const problems: string[] = [];
  const asPrinted = await runIn("as-printed", false);
  if (!asPrinted.includes(PACKAGE_REACHED)) {
    problems.push(
      `Node did not reach veryfront/integrations with the guide's setup:\n${asPrinted.trim()}`,
    );
  }
  const commonjs = await runIn("commonjs", true);
  if (!commonjs.includes(COMMONJS_IMPORT_ERROR)) {
    problems.push(
      `With "npm pkg set type=commonjs" Node should fail with "${COMMONJS_IMPORT_ERROR}":\n${commonjs.trim()}`,
    );
  }
  return problems;
}

async function listMarkdown(dir: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(new URL(dir, ROOT))) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) files.push(...await listMarkdown(path));
    else if (entry.name.endsWith(".md")) files.push(path);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

const denoConfig = JSON.parse(
  await Deno.readTextFile(new URL("deno.json", ROOT)),
);
const exportsMap = denoConfig.exports as Record<string, string>;
const schema = JSON.parse(
  await Deno.readTextFile(new URL(GRAPHQL_SCHEMA, ROOT)),
) as GraphqlSchemaSnapshot;
const subcommands = parseSubcommandUsage(integrationHelp.usage);
const tempDir = await Deno.makeTempDir({ prefix: "guide-snippets-" });
const tsFiles: Array<{ path: string; source: string }> = [];

try {
  for (const guide of SNIPPET_GUIDES) {
    const fences = extractFences(await Deno.readTextFile(new URL(guide, ROOT)));
    for (const fence of fences) {
      if (fence.lang === "ts") {
        const path = `${tempDir}/${
          guide.replaceAll(/[/.]/g, "_")
        }_${fence.line}.ts`;
        await Deno.writeTextFile(
          path,
          rewritePublicImports(
            fence.code,
            exportsMap,
            (target) => new URL(target, ROOT).href,
          ),
        );
        tsFiles.push({ path, source: `${guide}:${fence.line}` });
      } else if (fence.lang === "bash") {
        for (const issue of findUnquotedPlaceholders(fence.code)) {
          report(guide, fence.line + issue.line, issue.message);
        }
        const syntax = await run("bash", ["-n"], fence.code);
        if (!syntax.success) {
          report(guide, fence.line, `bash -n failed: ${syntax.text.trim()}`);
        }
        for (const document of extractGraphqlHeredocs(fence.code)) {
          for (const message of validateGraphqlOperation(document, schema)) {
            report(guide, fence.line, `GraphQL: ${message}`);
          }
        }
      } else if (fence.lang === "json") {
        try {
          JSON.parse(fence.code);
        } catch (error) {
          report(
            guide,
            fence.line,
            `Invalid JSON: ${(error as Error).message}`,
          );
        }
      }
    }
  }

  if (tsFiles.length > 0) {
    const check = await run(Deno.execPath(), [
      "check",
      "--config",
      "deno.json",
      ...tsFiles.map((file) => file.path),
    ]);
    if (!check.success) {
      let text = check.text;
      for (const file of tsFiles) {
        text = text.replaceAll(file.path, file.source);
      }
      issues.push(`deno check failed for guide snippets:\n${text.trim()}`);
    }
  }

  const nodeVersion = await run("node", ["--version"]).catch(() => undefined);
  if (!nodeVersion?.success || !nodeStripsTypes(nodeVersion.text)) {
    const message = `The Node first-call check needs Node.js 22.18+ or 23.6+; found ${
      nodeVersion?.success ? nodeVersion.text.trim() : "no node"
    }.`;
    // CI must run it; a contributor with an older Node gets a warning.
    if (Deno.env.get("CI")) report("docs/guides/integrations.md", 0, message);
    else console.warn(`Skipped: ${message}`);
  } else {
    try {
      for (
        const problem of await runNodeFirstCall(
          "docs/guides/integrations.md",
          `${tempDir}/node-first-call`,
        )
      ) {
        report("docs/guides/integrations.md", 0, problem);
      }
    } catch (error) {
      report("docs/guides/integrations.md", 0, (error as Error).message);
    }
  }

  for (const dir of GUIDANCE_DIRS) {
    for (const file of await listMarkdown(dir)) {
      const text = await Deno.readTextFile(new URL(file, ROOT));
      for (const issue of findSecretLiterals(text)) {
        report(file, issue.line, issue.message);
      }
      for (const issue of findUnquotedInlineCommands(text)) {
        report(file, issue.line, issue.message);
      }
      for (
        const issue of findUnknownIntegrationSubcommands(text, subcommands)
      ) {
        report(file, issue.line, issue.message);
      }
    }
  }
  for (const file of ["docs/guides/integrations.md"]) {
    const text = await Deno.readTextFile(new URL(file, ROOT));
    for (const issue of findSecretLiterals(text)) {
      report(file, issue.line, issue.message);
    }
    for (const issue of findUnquotedInlineCommands(text)) {
      report(file, issue.line, issue.message);
    }
    for (const issue of findUnknownIntegrationSubcommands(text, subcommands)) {
      report(file, issue.line, issue.message);
    }
  }
} finally {
  await Deno.remove(tempDir, { recursive: true });
}

if (issues.length > 0) {
  console.error(
    `Guide snippet check failed:\n${
      issues.map((issue) => `  ${issue}`).join("\n")
    }`,
  );
  Deno.exit(1);
}
console.log(
  `Guide snippets passed: ${tsFiles.length} TypeScript, bash, GraphQL, Node first-call, secret and CLI checks.`,
);
