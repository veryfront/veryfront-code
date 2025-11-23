#!/usr/bin/env -S deno run --allow-read
/**
 * Simple console.* usage checker for server/runtime code.
 * Exits non-zero if any console.* is found under packages/veryfront/src excluding:
 * - cli/**
 * - docs/**
 * - tests/**
 * - client runtime snippets embedded in strings (best-effort: ignore .ts literal checks)
 */

const root = "src";
const _decoder = new TextDecoder();

function stripStringLiterals(text: string): string {
  // Remove template literals, single and double quoted strings (best-effort)
  // - Handles escaped characters; not a full parser but sufficient for linting
  // Template literals (dotall)
  let out = text.replace(/`(?:\\.|[^`])*`/gs, "");
  // Single-quoted strings (no newlines)
  out = out.replace(/'(?:\\.|[^'\n])*'/g, "");
  // Double-quoted strings (no newlines)
  out = out.replace(/"(?:\\.|[^"\n])*"/g, "");
  return out;
}

function shouldSkip(path: string): boolean {
  return (
    path.includes("/cli/") ||
    path.includes("/docs/") ||
    path.includes("/tests/") ||
    path.endsWith(".test.ts") ||
    path.endsWith(".test.tsx") ||
    // Allow console usage inside logger implementations
    path.includes("/core/utils/logger/") ||
    path.includes("/rendering/client/browser-logger") ||
    path.includes("/rendering/client/browser-stubs/") ||
    // Allow console in dev tools
    path.includes("/ai/dev/")
  );
}

const violations: string[] = [];

// Start walk

async function walk(dir: string) {
  for await (const ent of Deno.readDir(dir)) {
    const full = `${dir}/${ent.name}`;
    if (ent.isDirectory) {
      await walk(full);
    } else if (ent.isFile && full.endsWith(".ts")) {
      if (shouldSkip(full)) continue;
      const raw = await Deno.readTextFile(full);
      const text = stripStringLiterals(raw);
      // Ignore console inside template strings that likely inject client code
      if (text.includes("console.")) {
        for (
          const line of text.split(/\r?\n/).map((l, i) => [i + 1, l] as const)
        ) {
          if (line[1].includes("console.")) {
            violations.push(`${full}:${line[0]}:${line[1].trim()}`);
          }
        }
      }
    }
  }
}

await walk(root);

if (violations.length > 0) {
  console.error(
    "Found console.* usages in server/runtime code:\n" + violations.join("\n"),
  );
  Deno.exit(1);
} else {
  console.log("No console.* usages in server/runtime code.");
}
