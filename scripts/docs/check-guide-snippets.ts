#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env
/**
 * Compile and statically check the runnable integration guide snippets.
 *
 * - `ts` fences: `deno check` against this checkout's public exports.
 * - `bash` fences: `bash -n`, no unquoted `<PLACEHOLDER>` tokens, and every
 *   `<<'GRAPHQL'` document validated against the checked-in schema snapshot.
 * - Integration guides, bundled skills and install templates: no
 *   credential-shaped literals and only released `veryfront integration`
 *   subcommands.
 *
 * Usage: deno task docs:snippets:check
 */

import {
  extractFences,
  extractGraphqlHeredocs,
  findSecretLiterals,
  findUnknownIntegrationSubcommands,
  findUnquotedPlaceholders,
  type GraphqlSchemaSnapshot,
  parseSubcommandUsage,
  rewritePublicImports,
  validateGraphqlOperation,
} from "./guide-snippets.ts";
import { integrationHelp } from "../../cli/commands/integration/command-help.ts";

const ROOT = new URL("../../", import.meta.url);
const SNIPPET_GUIDES = [
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

async function listMarkdown(dir: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(new URL(dir, ROOT))) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) files.push(...await listMarkdown(path));
    else if (entry.name.endsWith(".md")) files.push(path);
  }
  return files.sort();
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
          guide.replaceAll(/[\/.]/g, "_")
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

  for (const dir of GUIDANCE_DIRS) {
    for (const file of await listMarkdown(dir)) {
      const text = await Deno.readTextFile(new URL(file, ROOT));
      for (const issue of findSecretLiterals(text)) {
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
  `Guide snippets passed: ${tsFiles.length} TypeScript, bash, GraphQL, secret and CLI checks.`,
);
