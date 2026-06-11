#!/usr/bin/env -S deno run --allow-read
/**
 * Ratchet on Deno test sanitizer opt-outs.
 *
 * `sanitizeResources: false` / `sanitizeOps: false` disable Deno's detection of
 * leaked resources (file handles, sockets, timers) and pending async ops. Each
 * opt-out hides a potential real leak, so the count should only ever go down.
 *
 * This check counts the opt-outs across the test suite and fails if the total
 * exceeds the baseline below. When you remove opt-outs, lower the baseline to
 * lock in the win; the build will tell you the new number to set.
 */

const SCAN_ROOTS = [
  "src",
  "cli",
  "tests",
  "react",
  "extensions",
  "scripts",
] as const;

// Lower this when you remove sanitizer opt-outs. Never raise it without a very
// good reason — a new opt-out means a leak is being suppressed rather than fixed.
// 422 = 420 (historical) + 2 for the colocated tool-loading discovery test
// (src/discovery/agent-scoped-capabilities.test.ts): importModule transpiles
// via esbuild, whose warm child process trips the op/resource sanitizers —
// same rationale as src/discovery/transpiler.test.ts.
export const SANITIZER_OPT_OUT_BASELINE = 422;

const OPT_OUT_PATTERN = /sanitize(?:Resources|Ops|Exit)\s*:\s*false/g;

/** Count sanitizer opt-outs (`sanitizeResources/Ops/Exit: false`) in `source`. */
export function countSanitizerOptOuts(source: string): number {
  return source.match(OPT_OUT_PATTERN)?.length ?? 0;
}

export function isScannedFile(path: string): boolean {
  return path.endsWith(".ts") || path.endsWith(".tsx");
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
    } else if (ent.isFile && isScannedFile(full)) {
      await onFile(full);
    }
  }
}

async function main(): Promise<void> {
  let total = 0;
  for (const root of SCAN_ROOTS) {
    await walk(root, async (path) => {
      total += countSanitizerOptOuts(await Deno.readTextFile(path));
    });
  }

  if (!isWithinBaseline(total, SANITIZER_OPT_OUT_BASELINE)) {
    console.error(
      `Sanitizer opt-outs ${total} exceed baseline ${SANITIZER_OPT_OUT_BASELINE}. ` +
        `New tests should not add sanitizeResources/Ops/Exit: false — fix the leak ` +
        `(close handles, await pending ops) instead.`,
    );
    Deno.exit(1);
  }

  if (total < SANITIZER_OPT_OUT_BASELINE) {
    console.log(
      `Sanitizer opt-outs reduced to ${total} (baseline ${SANITIZER_OPT_OUT_BASELINE}). ` +
        `Lower SANITIZER_OPT_OUT_BASELINE to ${total} in check-sanitizer-baseline.ts to lock it in.`,
    );
    return;
  }

  console.log(
    `Sanitizer opt-out baseline ok: ${total}/${SANITIZER_OPT_OUT_BASELINE}.`,
  );
}

if (import.meta.main) {
  await main();
}
