#!/usr/bin/env -S deno run --allow-read
/**
 * Keeps every shared test primitive behind its one front door.
 *
 * The repository has one home per test capability, but each capability also
 * has a trail of local reimplementations that predate the home. Nothing
 * enforced arrival, so consolidations stalled: a migration would move a dozen
 * files and the next month would grow a dozen new copies. This ratchet freezes
 * the current copies as a per-rule, per-file baseline that may only shrink.
 *
 * ## The rules, and the home each one points at
 *
 *  - `fetch-assignment`: a bare `globalThis.fetch =` in a test file. Since the
 *    outbound transport landed, code under test that goes through
 *    `guardedOutboundFetch` reads the host transport, not the global, so a
 *    bare assignment leaves that path talking to the real network. The home
 *    is `withMockFetch` / `installMockFetch` in `src/testing/mock-fetch.ts`,
 *    which move the global and the transport together. This is the one rule
 *    that guards correctness rather than duplication.
 *
 *  - `temp-dir`: a raw `Deno.makeTempDir(` in a test file. The home is
 *    `makeTempDir` / `withTempDir` in `src/testing/deno-compat.ts`, which are
 *    runtime neutral and clean up after themselves.
 *
 *  - `local-helper`: a local declaration of `withTempDir`, `waitFor`,
 *    `installDomGlobals`, or `installDom`. Each shadows a shared helper
 *    (`deno-compat.ts` for the first two, `dom-globals.ts` for the DOM pair),
 *    and the name collision is exactly what blocked earlier migrations.
 *
 *  - `jsdom`: a `new JSDOM(` in a test file. Constructing the DOM is fine;
 *    the finding marks files to check for hand-rolled global installs. The
 *    home for installing and restoring browser globals is
 *    `installComponentDom` in `src/testing/dom-globals.ts`, which also drains
 *    pending animation frames so the op sanitizer does not report a leak.
 *
 * Matching is textual over comment- and string-stripped source, like the
 * sanitizer and skipped-test ratchets: every rule here is a syntactic spelling
 * that cannot hide behind formatting the way execution scope can.
 */

import {
  type Finding,
  findLineMatches,
  isTestFile,
  type RatchetSpec,
  runRatchet,
  stripCommentsAndStrings,
} from "./ratchet.ts";

/** One watched spelling and the baseline group it counts under. */
export interface FrontDoorRule {
  /** Baseline group key in testing-front-door-baseline.json. */
  group: string;
  /** Line-oriented pattern, matched against stripped source. Global flag required. */
  pattern: RegExp;
  message: string | ((match: RegExpExecArray) => string);
}

export const FRONT_DOOR_RULES: readonly FrontDoorRule[] = [
  {
    group: "fetch-assignment",
    pattern: /\bglobalThis\b(?:\s+as\s+[^)\n]*)?\)?\s*\.\s*fetch\s*=(?!=)/g,
    message:
      "globalThis.fetch assigned directly; use withMockFetch or installMockFetch " +
      "so the outbound transport moves with the global",
  },
  {
    group: "temp-dir",
    pattern: /\bDeno\s*\.\s*makeTempDir(?:Sync)?\s*\(/g,
    message:
      "raw Deno.makeTempDir; use makeTempDir or withTempDir from src/testing/deno-compat.ts",
  },
  {
    group: "local-helper",
    pattern:
      /\b(?:function\s+(withTempDir|waitFor|installDomGlobals|installDom)\s*[(<]|(?:const|let)\s+(withTempDir|waitFor|installDomGlobals|installDom)\s*=)/g,
    message: (match) =>
      `local ${
        match[1] ?? match[2]
      } declaration shadows the shared helper of the same name`,
  },
  {
    group: "jsdom",
    pattern: /\bnew\s+JSDOM\s*\(/g,
    message:
      "new JSDOM in a test file; install and restore its globals through installComponentDom",
  },
];

/** Every front-door bypass in `source`, tagged with its rule's baseline group. */
export function findFrontDoorBypasses(source: string, file: string): Finding[] {
  const stripped = stripCommentsAndStrings(source);
  const findings: Finding[] = [];
  for (const rule of FRONT_DOOR_RULES) {
    for (
      const finding of findLineMatches(
        stripped,
        file,
        rule.pattern,
        rule.message,
      )
    ) {
      findings.push({ ...finding, group: rule.group });
    }
  }
  return findings;
}

export const spec: RatchetSpec = {
  label: "Test primitive front-door bypasses",
  task: "lint:testing-front-door",
  scope: "test",
  select: isTestFile,
  scan: findFrontDoorBypasses,
  baseline: {
    kind: "per-group-file",
    path: "scripts/lint/testing-front-door-baseline.json",
  },
  advice:
    "Use the shared home for the primitive instead. Fetch stubbing: withMockFetch or " +
    "installMockFetch from src/testing/mock-fetch.ts (a bare globalThis.fetch assignment does " +
    "not control guardedOutboundFetch, so transport-routed code reaches the real network). " +
    "Temp dirs and polling: makeTempDir, withTempDir, and waitFor from " +
    "src/testing/deno-compat.ts. JSDOM globals: installComponentDom from " +
    'src/testing/dom-globals.ts. See the section "Where test primitives live" in ' +
    "tests/README.md.",
};

if (import.meta.main) {
  Deno.exit(await runRatchet(spec));
}
