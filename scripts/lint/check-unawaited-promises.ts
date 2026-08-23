#!/usr/bin/env -S deno run --allow-read
/**
 * Bans unawaited calls to async cleanup functions that are known to return
 * promises:
 *
 *  - `renderer.destroy()`
 *  - `cleanupRenderer()`
 *  - `cleanupBundler()`
 *
 * A fire-and-forget cleanup leaks the resources it was supposed to release and
 * races the next test. Only these specific callees are matched, to keep false
 * positives near zero; a statement-level call without `await` is a failure.
 */

import {
  type Finding,
  isTypeScriptFile,
  type RatchetSpec,
  runRatchet,
} from "./ratchet.ts";

const PATTERNS = [
  {
    regex: /^(?!.*await\s+).*renderer\.destroy\(\)/,
    description: "renderer.destroy() called without await (async method)",
  },
  {
    regex: /^(?!.*await\s+).*cleanupRenderer\(/,
    description: "cleanupRenderer() called without await (async function)",
  },
  {
    regex: /^(?!.*await\s+).*cleanupBundler\(/,
    description: "cleanupBundler() called without await (async function)",
  },
] as const;

function isStatementCall(trimmed: string): boolean {
  // Not a declaration, an assignment, or a return — those hand the promise on.
  return !trimmed.includes("= ") &&
    !trimmed.startsWith("return") &&
    !trimmed.includes("function") &&
    trimmed.includes("()");
}

function isSkippedLine(trimmed: string): boolean {
  return trimmed.length === 0 ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("export async function") ||
    trimmed.startsWith("async function") ||
    trimmed.startsWith("function ");
}

/** Every unawaited known-async cleanup call in `source`. */
export function findUnawaitedCleanupCalls(
  source: string,
  file: string,
): Finding[] {
  const findings: Finding[] = [];
  source.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (isSkippedLine(trimmed)) return;
    for (const pattern of PATTERNS) {
      if (pattern.regex.test(trimmed) && isStatementCall(trimmed)) {
        findings.push({
          file,
          line: index + 1,
          message: `${pattern.description}: ${trimmed}`,
        });
      }
    }
  });
  return findings;
}

export const spec: RatchetSpec = {
  label: "Unawaited cleanup calls",
  task: "lint:check-awaits",
  scope: "test",
  select: isTypeScriptFile,
  scan: findUnawaitedCleanupCalls,
  baseline: { kind: "zero" },
  advice:
    "These calls return promises — add `await` so the cleanup finishes before the next step.",
};

if (import.meta.main) {
  Deno.exit(await runRatchet(spec));
}
