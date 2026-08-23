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
 * This check counts skipped tests across every test file under the `deno.json`
 * test roots and fails if the total grows beyond the baseline below. It does
 * NOT forbid skips outright (some are legitimately blocked on upstream fixes) —
 * it just stops the pile from growing silently. When you re-enable or remove
 * skips, the task prints the new total so you can lower the baseline and lock
 * in the win (`deno task lint:skipped-tests:update` writes it for you).
 */

import {
  type Finding,
  findLineMatches,
  isTestFile,
  type RatchetSpec,
  runRatchet,
  stripCommentsAndStrings,
} from "./ratchet.ts";

// Lower this when you re-enable or delete skipped tests. Raising it means new
// dead coverage is being added — prefer fixing or deleting the test instead.
export const SKIPPED_TEST_BASELINE = 18;

// Method form: it.skip( / describe.ignore( / test.skip( / Deno.test.ignore(
const METHOD_FORM = /\b(?:it|describe|test|Deno\.test)\.(?:skip|ignore)\s*\(/g;
// Option form: bare `skip: true` / `ignore: true` in a test options object.
const OPTION_FORM = /\b(?:skip|ignore)\s*:\s*true\b/g;

/** Every skipped/ignored test (method and option forms) in `source`. */
export function findSkippedTests(source: string, file: string): Finding[] {
  const stripped = stripCommentsAndStrings(source);
  return [
    ...findLineMatches(stripped, file, METHOD_FORM, (match) => match[0].trim()),
    ...findLineMatches(stripped, file, OPTION_FORM, (match) => match[0]),
  ];
}

export const spec: RatchetSpec = {
  label: "Skipped tests",
  task: "lint:skipped-tests",
  scope: "test",
  select: isTestFile,
  scan: findSkippedTests,
  baseline: {
    kind: "total",
    value: SKIPPED_TEST_BASELINE,
    constant: "SKIPPED_TEST_BASELINE",
    module: import.meta.url,
  },
  advice:
    "Don't add new it.skip/it.ignore (or skip/ignore: true) — fix and re-enable " +
    "the test, or delete it and record why in the commit/issue.",
};

if (import.meta.main) {
  Deno.exit(await runRatchet(spec));
}
