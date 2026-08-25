/**
 * Unit tests for the pure half of the ratchet engine: predicates, source
 * stripping, matching, counting, and baseline (de)serialization. The
 * filesystem walk and the end-to-end `runRatchet` behaviour need temp repos
 * and a subprocess, so they live in
 * tests/integration/semantic-unit-boundary/scripts/lint/ratchet.test.ts.
 */

import { assertEquals, assertThrows } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  compareCounts,
  countFindings,
  type Finding,
  findLineMatches,
  isExecutableTestFile,
  isIgnoredDirectory,
  isSourceFile,
  isTestFile,
  isTypeScriptFile,
  parseBaseline,
  rewriteInlineConstant,
  serializeBaseline,
  stripCommentsAndStrings,
  toRepoRelative,
} from "./ratchet.ts";

describe("predicates", () => {
  it("isTestFile matches the suite planner's rule", () => {
    assertEquals(isTestFile("src/a.test.ts"), true);
    assertEquals(isTestFile("src/a.test.tsx"), true);
    assertEquals(isTestFile("tests/a.test.mjs"), true);
    assertEquals(isTestFile("src/a.ts"), false);
    assertEquals(isTestFile("src/testing/bdd.ts"), false);
    assertEquals(isTestFile("src/a.test.js"), false);
  });

  it("isExecutableTestFile takes every suffix tests/README.md documents", () => {
    assertEquals(isExecutableTestFile("src/a.test.ts"), true);
    assertEquals(isExecutableTestFile("src/a.test.tsx"), true);
    assertEquals(isExecutableTestFile("tests/a.test.js"), true);
    assertEquals(isExecutableTestFile("tests/a.test.mjs"), true);
    assertEquals(isExecutableTestFile("tests/a.test.cjs"), true);
    assertEquals(isExecutableTestFile("tests/e2e/a.playwright.ts"), true);
    assertEquals(isExecutableTestFile("src/a.ts"), false);
    assertEquals(isExecutableTestFile("src/a.spec.ts"), false);
    assertEquals(isExecutableTestFile("tests/a.playwright.js"), false);
  });

  it("isTypeScriptFile takes any .ts/.tsx but no declarations", () => {
    assertEquals(isTypeScriptFile("src/a.ts"), true);
    assertEquals(isTypeScriptFile("src/a.test.tsx"), true);
    assertEquals(isTypeScriptFile("src/a.d.ts"), false);
    assertEquals(isTypeScriptFile("src/a.js"), false);
  });

  it("isSourceFile excludes tests and declarations", () => {
    assertEquals(isSourceFile("src/a.ts"), true);
    assertEquals(isSourceFile("src/a.tsx"), true);
    assertEquals(isSourceFile("src/a.test.ts"), false);
    assertEquals(isSourceFile("src/a.d.ts"), false);
    assertEquals(isSourceFile("src/a.json"), false);
  });

  it("isIgnoredDirectory skips dot-directories, node_modules, dist, coverage", () => {
    for (
      const name of [
        ".git",
        ".omc",
        ".worktrees",
        "node_modules",
        "dist",
        "coverage",
      ]
    ) {
      assertEquals(isIgnoredDirectory(name), true, name);
    }
    assertEquals(isIgnoredDirectory("src"), false);
    assertEquals(isIgnoredDirectory("distribution"), false);
  });

  it("toRepoRelative strips the root and normalises separators", () => {
    assertEquals(toRepoRelative("/repo/src/a.ts", "/repo/"), "src/a.ts");
    assertEquals(
      toRepoRelative("C:\\repo\\src\\a.ts", "C:\\repo\\"),
      "src/a.ts",
    );
  });
});

describe("stripCommentsAndStrings", () => {
  it("blanks comments and string literals", () => {
    const stripped = stripCommentsAndStrings(
      [
        "// it.only(a)",
        "/* it.only(b) */ keep();",
        'const s = "it.only(c)";',
        "const t = `it.only(d)`;",
        'const u = "http://x"; // it.only(e)',
      ].join("\n"),
    );
    assertEquals(stripped.includes("it.only"), false);
    assertEquals(stripped.includes("keep();"), true);
  });

  it("strips pathological escape runs in linear time", () => {
    // The ambiguous `(?:\\.|[^`])*` form backtracked exponentially on exactly
    // this shape: an opening quote followed by thousands of escapes and no
    // closing quote. The unrolled patterns must stay linear. The elapsed guard
    // is deliberately coarse — the linear scan takes microseconds, while the
    // old pattern would effectively never return.
    const escapes = "\\a".repeat(5000);
    const started = Date.now();

    const unterminated = stripCommentsAndStrings(`\`${escapes}`);
    const terminated = stripCommentsAndStrings(`\`${escapes}\` after`);
    const quoted = stripCommentsAndStrings(`"${escapes}`);

    assertEquals(Date.now() - started < 2000, true, "stripping must be linear");
    assertEquals(unterminated, `\`${escapes}`, "no closing quote, no match");
    assertEquals(terminated, "`` after");
    assertEquals(quoted, `"${escapes}`);
  });

  it("preserves line numbers across multi-line comments and templates", () => {
    const source = [
      "/**",
      " * header",
      " */",
      "const t = `a",
      "b`;",
      "target();",
    ].join("\n");
    const lines = stripCommentsAndStrings(source).split("\n");
    assertEquals(lines.length, 6);
    assertEquals(lines[5], "target();");
  });
});

describe("findLineMatches", () => {
  it("reports one finding per match with 1-based lines", () => {
    const findings = findLineMatches(
      "a\nTODO TODO\n\nTODO",
      "f.ts",
      /TODO/g,
      "todo",
    );
    assertEquals(findings.map((f) => f.line), [2, 2, 4]);
    assertEquals(findings[0], { file: "f.ts", line: 2, message: "todo" });
  });

  it("derives the message from the match", () => {
    const [finding] = findLineMatches(
      "x: 1",
      "f.ts",
      /(\w+): (\d)/g,
      (m) => `${m[1]}=${m[2]}`,
    );
    assertEquals(finding?.message, "x=1");
  });

  it("rejects a non-global pattern, which would loop on the first match", () => {
    assertThrows(() => findLineMatches("a", "f.ts", /a/, "m"), Error, "global");
  });
});

describe("counts and baselines", () => {
  const findings: Finding[] = [
    { file: "b.ts", line: 1, message: "m", group: "r1" },
    { file: "a.ts", line: 3, message: "m", group: "r1" },
    { file: "a.ts", line: 9, message: "m", group: "r1" },
    { file: "a.ts", line: 2, message: "m", group: "r2" },
  ];

  it("countFindings aggregates per baseline kind", () => {
    assertEquals(countFindings(findings, "total"), { total: 4 });
    assertEquals(countFindings(findings, "per-file"), { "a.ts": 3, "b.ts": 1 });
    assertEquals(countFindings(findings, "per-group-file"), {
      "r1 a.ts": 2,
      "r1 b.ts": 1,
      "r2 a.ts": 1,
    });
    assertEquals(countFindings([], "total"), {});
  });

  it("countFindings refuses a per-group-file finding without a group", () => {
    assertThrows(
      () =>
        countFindings(
          [{ file: "a.ts", line: 1, message: "m" }],
          "per-group-file",
        ),
      Error,
      "without a group",
    );
  });

  it("compareCounts flags growth, shrinkage, and unlisted keys", () => {
    const { regressions, improvements } = compareCounts(
      { "a.ts": 3, "new.ts": 1, "same.ts": 2 },
      { "a.ts": 2, "gone.ts": 1, "same.ts": 2 },
    );
    assertEquals(regressions, [
      { key: "a.ts", then: 2, now: 3 },
      { key: "new.ts", then: 0, now: 1 },
    ]);
    assertEquals(improvements, [{ key: "gone.ts", then: 1, now: 0 }]);
  });

  it("serializes and parses every baseline kind round-trip", () => {
    for (const kind of ["total", "per-file", "per-group-file"] as const) {
      const counts = countFindings(findings, kind);
      const text = serializeBaseline(kind, counts);
      assertEquals(parseBaseline(kind, JSON.parse(text), "t"), counts, kind);
    }
    assertEquals(serializeBaseline("total", { total: 7 }), "7");
    assertEquals(
      serializeBaseline("per-group-file", { "r1 a.ts": 2, "r2 a.ts": 1 }),
      JSON.stringify({ r1: { "a.ts": 2 }, r2: { "a.ts": 1 } }, null, 2),
    );
  });

  it("parseBaseline rejects malformed baselines", () => {
    assertThrows(() => parseBaseline("total", -1, "t"));
    assertThrows(() => parseBaseline("total", "3", "t"));
    assertThrows(() => parseBaseline("per-file", ["a.ts"], "t"));
    assertThrows(() => parseBaseline("per-file", { "a.ts": 0 }, "t"));
    assertThrows(() => parseBaseline("per-file", { "a.ts": "2" }, "t"));
    assertThrows(() => parseBaseline("per-group-file", { r: 1 }, "t"));
    assertThrows(() =>
      parseBaseline("per-group-file", { r: { "a.ts": 1.5 } }, "t")
    );
    assertEquals(parseBaseline("zero", undefined, "t"), {});
  });

  it("rewriteInlineConstant replaces exactly one declaration", () => {
    const source = "// n\nexport const X_BASELINE = 12;\nexport const Y = 3;\n";
    assertEquals(
      rewriteInlineConstant(source, "X_BASELINE", 9),
      "// n\nexport const X_BASELINE = 9;\nexport const Y = 3;\n",
    );
    assertThrows(
      () => rewriteInlineConstant(source, "MISSING", 1),
      Error,
      "found 0",
    );
  });
});
