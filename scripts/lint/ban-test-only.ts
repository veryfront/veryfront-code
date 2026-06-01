#!/usr/bin/env -S deno run --allow-read
/**
 * Bans focused tests (`it.only` / `describe.only` / `test.only`) in committed
 * test files.
 *
 * A focused test silently skips every sibling test in its file, so a stray
 * `.only` that lands on `main` quietly disables real coverage while CI stays
 * green. This check fails the build if any focused test is found.
 *
 * Scans `*.test.ts` / `*.test.tsx` under src/, cli/, and tests/, skipping
 * vendored `node_modules`. The BDD wrapper that legitimately exposes `.only`
 * (src/testing/bdd.ts) is not a test file and is therefore not scanned.
 */

const SCAN_ROOTS = ["src", "cli", "tests"] as const;

/** Strip comments and string/template literals so they can't trigger false matches. */
function stripCommentsAndStrings(text: string): string {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, ""); // block comments
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, "$1"); // line comments (keep http:// etc.)
  out = out.replace(/`(?:\\.|[^`])*`/gs, "``"); // template literals
  out = out.replace(/'(?:\\.|[^'\n])*'/g, "''"); // single-quoted
  out = out.replace(/"(?:\\.|[^"\n])*"/g, '""'); // double-quoted
  return out;
}

/** Returns the 1-based line numbers of focused-test calls in `source`. */
export function findFocusedTests(source: string): number[] {
  const stripped = stripCommentsAndStrings(source);
  const pattern = /\b(?:it|describe|test|Deno\.test)\.only\s*\(/;
  const hits: number[] = [];
  stripped.split(/\r?\n/).forEach((line, i) => {
    if (pattern.test(line)) hits.push(i + 1);
  });
  return hits;
}

export function isTestFile(path: string): boolean {
  return path.endsWith(".test.ts") || path.endsWith(".test.tsx");
}

async function walk(
  dir: string,
  onFile: (path: string) => Promise<void>,
): Promise<void> {
  let entries: AsyncIterable<Deno.DirEntry>;
  try {
    entries = Deno.readDir(dir);
  } catch (_) {
    return; // expected: a scan root may not exist in every checkout
  }
  for await (const ent of entries) {
    if (ent.name === "node_modules") continue;
    const full = `${dir}/${ent.name}`;
    if (ent.isDirectory) {
      await walk(full, onFile);
    } else if (ent.isFile && isTestFile(full)) {
      await onFile(full);
    }
  }
}

async function main(): Promise<void> {
  const violations: string[] = [];

  for (const root of SCAN_ROOTS) {
    await walk(root, async (path) => {
      const source = await Deno.readTextFile(path);
      for (const line of findFocusedTests(source)) {
        violations.push(`${path}:${line}`);
      }
    });
  }

  if (violations.length > 0) {
    console.error(
      `Found ${violations.length} focused test(s) (it.only/describe.only). ` +
        `These silently skip sibling tests — remove the .only:\n` +
        violations.join("\n"),
    );
    Deno.exit(1);
  }

  console.log("No focused tests (it.only/describe.only) found.");
}

if (import.meta.main) {
  await main();
}
