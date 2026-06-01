#!/usr/bin/env -S deno run --allow-read
/**
 * Ratchet on skipped/ignored tests.
 *
 * `it.skip` / `describe.skip` / `Deno.test.ignore`, and the option forms
 * `it({ skip: true }, fn)` / `{ ignore: true }`, disable a test without
 * deleting it. Each one is dead coverage that quietly rots — the assertion no
 * longer runs but still looks present. The count should only ever go down: a
 * skip is either fixed and re-enabled, or deleted with its reason recorded in
 * the commit/issue.
 *
 * This check counts skipped tests across the suite and fails if the total grows
 * beyond the baseline below. It does NOT forbid skips outright (some are
 * legitimately blocked on upstream fixes) — it just stops the pile from growing
 * silently. When you re-enable or remove skips, the task prints the new total
 * so you can lower the baseline and lock in the win.
 */

const SCAN_ROOTS = [
  "src",
  "cli",
  "tests",
  "react",
  "extensions",
  "scripts",
] as const;

// Lower this when you re-enable or delete skipped tests. Raising it means new
// dead coverage is being added — prefer fixing or deleting the test instead.
export const SKIPPED_TEST_BASELINE = 22;

// Method form: it.skip( / describe.ignore( / test.skip( / Deno.test.ignore(
const METHOD_FORM = /\b(?:it|describe|test|Deno\.test)\.(?:skip|ignore)\s*\(/g;
// Option form: bare `skip: true` / `ignore: true` in a test options object.
const OPTION_FORM = /\b(?:skip|ignore)\s*:\s*true\b/g;

/** Strip comments and string/template literals so they can't trigger false matches. */
function stripCommentsAndStrings(text: string): string {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, ""); // block comments
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, "$1"); // line comments (keep http:// etc.)
  out = out.replace(/`(?:\\.|[^`])*`/gs, "``"); // template literals
  out = out.replace(/'(?:\\.|[^'\n])*'/g, "''"); // single-quoted
  out = out.replace(/"(?:\\.|[^"\n])*"/g, '""'); // double-quoted
  return out;
}

/** Count skipped/ignored tests (method and option forms) in `source`. */
export function countSkippedTests(source: string): number {
  const stripped = stripCommentsAndStrings(source);
  const method = stripped.match(METHOD_FORM)?.length ?? 0;
  const option = stripped.match(OPTION_FORM)?.length ?? 0;
  return method + option;
}

export function isTestFile(path: string): boolean {
  return path.endsWith(".test.ts") || path.endsWith(".test.tsx");
}

export function isWithinBaseline(count: number, baseline: number): boolean {
  return count <= baseline;
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
  let total = 0;
  for (const root of SCAN_ROOTS) {
    await walk(root, async (path) => {
      total += countSkippedTests(await Deno.readTextFile(path));
    });
  }

  if (!isWithinBaseline(total, SKIPPED_TEST_BASELINE)) {
    console.error(
      `Skipped/ignored tests ${total} exceed baseline ${SKIPPED_TEST_BASELINE}. ` +
        `Don't add new it.skip/it.ignore (or skip/ignore: true) — fix and ` +
        `re-enable the test, or delete it and record why in the commit/issue.`,
    );
    Deno.exit(1);
  }

  if (total < SKIPPED_TEST_BASELINE) {
    console.log(
      `Skipped tests reduced to ${total} (baseline ${SKIPPED_TEST_BASELINE}). ` +
        `Lower SKIPPED_TEST_BASELINE to ${total} in check-skipped-tests-baseline.ts to lock it in.`,
    );
    return;
  }

  console.log(`Skipped-test baseline ok: ${total}/${SKIPPED_TEST_BASELINE}.`);
}

if (import.meta.main) {
  await main();
}
