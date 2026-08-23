#!/usr/bin/env -S deno run --allow-read
/**
 * Bans focused tests (`it.only` / `describe.only` / `test.only`) in committed
 * test files.
 *
 * A focused test silently skips every sibling test in its file, so a stray
 * focus that lands on `main` quietly disables real coverage while CI stays
 * green. This check fails the build if any focused test is found.
 *
 * Two focusing forms are detected, because the project's BDD wrapper
 * (src/testing/bdd.ts) honours both:
 *   1. the method form  — `it.only(...)`, `describe.only(...)`, `Deno.test.only(...)`
 *   2. the option form  — `it({ name, only: true }, fn)` / `describe({ only: true }, fn)`
 *
 * Scans every test file under the `deno.json` test roots. The BDD wrapper that
 * legitimately exposes `.only` is not a test file and is therefore not scanned.
 */

import {
  type Finding,
  findLineMatches,
  isTestFile,
  type RatchetSpec,
  runRatchet,
  stripCommentsAndStrings,
} from "./ratchet.ts";

// Method form: it.only( / describe.only( / test.only( / Deno.test.only(
const METHOD_FORM = /\b(?:it|describe|test|Deno\.test)\.only\s*\(/g;
// Option form: a bare `only: true` key inside a test options object. `\bonly`
// won't match `readOnly`/`commandOnly` (capital O), and `only: false` is ignored.
// (Quoted keys like `"only": true` are not matched — they're stripped with other
// string literals and nobody writes test options that way.)
const OPTION_FORM = /\bonly\s*:\s*true\b/g;

/** Every focused-test call in `source`, one finding per line. */
export function findFocusedTests(source: string, file: string): Finding[] {
  const stripped = stripCommentsAndStrings(source);
  return [
    ...findLineMatches(stripped, file, METHOD_FORM, (match) => match[0].trim()),
    ...findLineMatches(stripped, file, OPTION_FORM, (match) => match[0]),
  ];
}

export const spec: RatchetSpec = {
  label: "Focused tests",
  task: "lint:ban-test-only",
  scope: "test",
  select: isTestFile,
  scan: findFocusedTests,
  baseline: { kind: "zero" },
  advice:
    "Focused tests (.only(...) or only: true) silently skip sibling tests — remove the focus.",
};

if (import.meta.main) {
  Deno.exit(await runRatchet(spec));
}
