#!/usr/bin/env -S deno run --allow-read
/**
 * Ratchet on Deno test sanitizer opt-outs.
 *
 * `sanitizeResources: false` / `sanitizeOps: false` disable Deno's detection of
 * leaked resources (file handles, sockets, timers) and pending async ops. Each
 * opt-out hides a potential real leak, so the count should only ever go down.
 *
 * This check counts the opt-outs across every TypeScript file under the
 * `deno.json` test roots and fails if the total exceeds the baseline below.
 * When you remove opt-outs, lower the baseline to lock in the win; the build
 * tells you the new number, and `deno task lint:sanitizer-baseline:update`
 * writes it for you.
 */

import {
  type Finding,
  findLineMatches,
  isTypeScriptFile,
  type RatchetSpec,
  runRatchet,
} from "./ratchet.ts";

// Lower this when you remove sanitizer opt-outs. Never raise it without a very
// good reason — a new opt-out means a leak is being suppressed rather than fixed.
// 368 after the transforms/mdx, transforms/esm, and module audits removed
// their remaining sanitizer opt-outs.
export const SANITIZER_OPT_OUT_BASELINE = 368;

const OPT_OUT_PATTERN = /sanitize(?:Resources|Ops|Exit)\s*:\s*false/g;

/** Every sanitizer opt-out (`sanitizeResources/Ops/Exit: false`) in `source`. */
export function findSanitizerOptOuts(source: string, file: string): Finding[] {
  return findLineMatches(source, file, OPT_OUT_PATTERN, (match) => match[0]);
}

export const spec: RatchetSpec = {
  label: "Sanitizer opt-outs",
  task: "lint:sanitizer-baseline",
  scope: "test",
  select: isTypeScriptFile,
  scan: findSanitizerOptOuts,
  baseline: {
    kind: "total",
    value: SANITIZER_OPT_OUT_BASELINE,
    constant: "SANITIZER_OPT_OUT_BASELINE",
    module: import.meta.url,
  },
  advice:
    "New tests should not add sanitizeResources/Ops/Exit: false. Fix the leak " +
    "(close handles, await pending ops) instead.",
};

if (import.meta.main) {
  Deno.exit(await runRatchet(spec));
}
