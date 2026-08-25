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
 *  - `jsdom`: a `new JSDOM(` whose DOM is not handed to the shared harness.
 *    Constructing the DOM is fine; the bypass is wiring its globals by hand.
 *    The home for installing and restoring browser globals is
 *    `installComponentDom` in `src/testing/dom-globals.ts`, which also drains
 *    pending animation frames so the op sanitizer does not report a leak.
 *
 * Matching is textual over comment- and string-stripped source, like the
 * sanitizer and skipped-test ratchets: every rule here is a syntactic spelling
 * that cannot hide behind formatting the way execution scope can. The scan
 * covers every executable test filename tests/README.md documents, Playwright
 * suites included, so no runner's tests can grow a bypass off-baseline.
 */

import {
  type Finding,
  isExecutableTestFile,
  type RatchetSpec,
  runRatchet,
  stripCommentsAndStrings,
} from "./ratchet.ts";

/** One watched spelling and the baseline group it counts under. */
export interface FrontDoorRule {
  /** Baseline group key in testing-front-door-baseline.json. */
  group: string;
  /** Pattern over the stripped source. Global flag required. */
  pattern: RegExp;
  /** Skip one match that the stripped source shows is already at the front door. */
  exemptMatch?: (match: RegExpExecArray, stripped: string) => boolean;
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
    // The optional binding capture ties each construction to the variable it
    // is assigned to, so the exemption can demand a harness call for that
    // specific DOM.
    pattern:
      /(?:\b(?:const|let|var)\s+)?(?:([A-Za-z_$][\w$]*)\s*=\s*)?\bnew\s+JSDOM\s*\(/g,
    // Constructing a JSDOM is the prescribed first half of the pattern; the
    // bypass is wiring its globals by hand. A construction is exempt only when
    // its DOM demonstrably reaches the shared harness: either the `new` sits
    // directly inside the `installComponentDom(...)` argument, or the binding
    // it is assigned to is passed to `installComponentDom` elsewhere in the
    // file. An unused import or a mention in a comment exempts nothing, and a
    // hand-wired DOM keeps counting beside a correctly wrapped one.
    exemptMatch: (match, stripped) => {
      if (
        /\binstallComponentDom\s*\(\s*$/.test(stripped.slice(0, match.index))
      ) {
        return true;
      }
      const binding = match[1];
      return binding !== undefined &&
        new RegExp(`\\binstallComponentDom\\s*\\(\\s*${binding}\\b`)
          .test(stripped);
    },
    message:
      "new JSDOM in a test file; install and restore its globals through installComponentDom",
  },
];

/** 1-based line of `index` in `text`, whose newlines mirror the source's. */
function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/** Every front-door bypass in `source`, tagged with its rule's baseline group. */
export function findFrontDoorBypasses(source: string, file: string): Finding[] {
  const stripped = stripCommentsAndStrings(source);
  const findings: Finding[] = [];
  for (const rule of FRONT_DOOR_RULES) {
    if (!rule.pattern.global) {
      throw new Error(`front-door rule needs a global pattern: ${rule.group}`);
    }
    rule.pattern.lastIndex = 0;
    for (
      let match = rule.pattern.exec(stripped);
      match !== null;
      match = rule.pattern.exec(stripped)
    ) {
      if (match[0].length === 0) rule.pattern.lastIndex += 1;
      if (rule.exemptMatch?.(match, stripped)) continue;
      findings.push({
        file,
        line: lineAt(stripped, match.index),
        message: typeof rule.message === "string"
          ? rule.message
          : rule.message(match),
        group: rule.group,
      });
    }
  }
  return findings;
}

export const spec: RatchetSpec = {
  label: "Test primitive front-door bypasses",
  task: "lint:testing-front-door",
  scope: "test",
  select: isExecutableTestFile,
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
