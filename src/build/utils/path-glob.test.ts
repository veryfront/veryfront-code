import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { compilePathGlob } from "./path-glob.ts";

function assertMatches(pattern: string, matches: string[], rejects: string[]): void {
  const matcher = compilePathGlob(pattern);
  for (const path of matches) {
    assertEquals(matcher.test(path), true, `${JSON.stringify(pattern)} should match ${path}`);
  }
  for (const path of rejects) {
    assertEquals(matcher.test(path), false, `${JSON.stringify(pattern)} should not match ${path}`);
  }
}

describe("build/utils/path-glob", () => {
  it("anchors segment wildcards and single-character wildcards", () => {
    assertMatches("*.ts", ["index.ts", ".ts"], ["index.tsx", "src/index.ts"]);
    assertMatches("file?.ts", ["file1.ts", "filex.ts"], ["file.ts", "file10.ts"]);
    assertMatches("a**b.ts", ["ab.ts", "anythingb.ts"], ["dir/ab.ts", "ab.tsx"]);
  });

  it("matches globstar only as a complete path segment", () => {
    assertMatches(
      "src/**/*.ts",
      ["src/index.ts", "src/lib/index.ts", "src/lib/nested/index.ts"],
      ["index.ts", "src/index.js", "other/index.ts"],
    );
    assertMatches("**/*.tsx", ["page.tsx", "app/page.tsx"], ["page.ts"]);
    assertMatches("app/**/page.tsx", ["app/page.tsx", "app/a/b/page.tsx"], [
      "page.tsx",
      "apps/page.tsx",
    ]);
  });

  it("supports brace alternatives and nested extended groups", () => {
    assertMatches("*.{ts,tsx}", ["page.ts", "page.tsx"], ["page.js", "page.tsxx"]);
    assertMatches("{app,@(pages|src)}/**/*.{ts,tsx}", [
      "app/page.tsx",
      "pages/about.ts",
      "src/lib/value.ts",
    ], ["components/page.tsx", "src/lib/value.js"]);
    assertMatches("file{,.test}.ts", ["file.ts", "file.test.ts"], ["file.spec.ts"]);
  });

  it("treats route-group parentheses as literal path characters", () => {
    assertMatches("app/(marketing)/**/*.tsx", [
      "app/(marketing)/page.tsx",
      "app/(marketing)/nested/page.tsx",
    ], [
      "app/marketing/page.tsx",
      "app/(sales)/page.tsx",
    ]);
    assertMatches("page).tsx", ["page).tsx"], ["page.tsx"]);
  });

  it("supports each Bash-style extended group", () => {
    assertMatches("@(page|layout).tsx", ["page.tsx", "layout.tsx"], [
      "pagelayout.tsx",
      "route.tsx",
    ]);
    assertMatches("?(pre)fix.ts", ["fix.ts", "prefix.ts"], ["preprefix.ts"]);
    assertMatches("*(ab)c.ts", ["c.ts", "abc.ts", "ababc.ts"], ["ac.ts"]);
    assertMatches("+(ab)c.ts", ["abc.ts", "ababc.ts"], ["c.ts", "ac.ts"]);
    assertMatches("!(test).ts", ["page.ts", "contest.ts"], ["test.ts"]);
    assertMatches("!(|foo).ts", ["bar.ts"], [".ts", "foo.ts", "foobar.ts"]);
  });

  it("keeps normalized path semantics instead of legacy empty-segment leakage", () => {
    assertMatches("**/!(a|b)", ["c", "x/c"], ["a", "b", "x/a", "x/b"]);
    assertMatches("a/*", ["a/b"], ["a", "a/"]);
  });

  it("preserves captured extended-glob and globstar compatibility where semantics agree", () => {
    const parityCases: ReadonlyArray<{
      pattern: string;
      matches: string[];
      rejects: string[];
    }> = [
      {
        pattern: "!(foo|bar).ts",
        matches: ["baz.ts", "quxfoo.ts"],
        rejects: ["foo.ts", "bar.ts", "foobar.ts"],
      },
      {
        pattern: "src/!(generated|vendor)/**/*.ts",
        matches: ["src/app/index.ts"],
        rejects: [
          "src/generated/index.ts",
          "src/generated-extra/index.ts",
          "src/vendor/a.ts",
          "src/vendorized/a.ts",
        ],
      },
      {
        pattern: "foo!(@(bar|baz)|qux)end",
        matches: ["fooend", "foomoreend"],
        rejects: ["foobarend", "foobazend", "fooquxend", "foobazmoreend"],
      },
      {
        pattern: "@(src|app)/**/!(*.test).@(ts|tsx)",
        matches: ["src/a.ts", "src/x/a.tsx", "app/test.ts", "app/.ts"],
        rejects: ["src/a.test.ts", "other/a.ts"],
      },
      {
        pattern: "a/**",
        matches: ["a/", "a/b", "a/b/c"],
        rejects: ["a", "b"],
      },
      {
        pattern: "a/**/b/**",
        matches: ["a/b/", "a/b/c", "a/x/b/c"],
        rejects: ["a/b", "a/x/b"],
      },
      {
        pattern: "a/**/**",
        matches: ["a/b", "a/b/c"],
        rejects: ["a"],
      },
      {
        pattern: "a/**/b",
        matches: ["a/b", "a/x/b", "a/x/y/b"],
        rejects: ["a", "a/x"],
      },
      {
        pattern: "{src,app}/**/*.{ts,tsx}",
        matches: ["src/a.ts", "src/x/a.tsx", "app/a.tsx"],
        rejects: ["app/a.js", "other/a.ts"],
      },
    ];

    for (const testCase of parityCases) {
      assertMatches(testCase.pattern, testCase.matches, testCase.rejects);
    }
  });

  it("treats an empty negative alternative as excluding the zero-length endpoint", () => {
    const emptyAlternativeCases: ReadonlyArray<{
      pattern: string;
      matches: string[];
      rejects: string[];
    }> = [
      {
        pattern: "!(|foo).ts",
        matches: ["bar.ts"],
        rejects: ["foo.ts", ".ts", "foobar.ts"],
      },
      {
        pattern: "!(foo|).ts",
        matches: ["bar.ts"],
        rejects: ["foo.ts", ".ts", "foobar.ts"],
      },
      {
        pattern: "!(|).ts",
        matches: ["bar.ts"],
        rejects: [".ts"],
      },
      {
        pattern: "a!(|b)c",
        matches: ["axc"],
        rejects: ["abc", "ac"],
      },
      // Control: the same negation without an empty alternative still
      // excludes only the forbidden stem.
      {
        pattern: "!(foo).ts",
        matches: ["bar.ts", ".ts"],
        rejects: ["foo.ts", "foobar.ts"],
      },
      // Positive extglobs honor the empty alternative as a zero-length branch.
      {
        pattern: "@(|foo).ts",
        matches: ["foo.ts", ".ts"],
        rejects: ["bar.ts"],
      },
      {
        pattern: "?(|foo).ts",
        matches: ["foo.ts", ".ts"],
        rejects: ["bar.ts"],
      },
    ];

    for (const testCase of emptyAlternativeCases) {
      assertMatches(testCase.pattern, testCase.matches, testCase.rejects);
    }
  });

  it("supports character ranges, negation, POSIX classes, and escapes", () => {
    assertMatches("file[0-2].ts", ["file0.ts", "file2.ts"], ["file3.ts", "file10.ts"]);
    assertMatches("file[!0-2].ts", ["file3.ts", "filex.ts"], ["file0.ts"]);
    assertMatches("[[:digit:]][[:alpha:]].ts", ["1a.ts", "9Z.ts"], ["aa.ts"]);
    assertMatches("file\\*.ts", ["file*.ts"], ["file1.ts"]);
    assertMatches("file[?].ts", ["file?.ts"], ["file1.ts"]);
  });

  it("normalizes candidate separators while preserving absolute-path anchoring", () => {
    assertMatches("src/**/*.ts", ["src\\index.ts", "src\\lib\\index.ts"], [
      "other\\index.ts",
    ]);
    assertMatches("/project/**/*.ts", ["/project/index.ts", "\\project\\lib\\index.ts"], [
      "project/index.ts",
      "/other/index.ts",
    ]);
    assertMatches("src//*.ts/", ["src/index.ts", "src//index.ts/"], ["index.ts"]);
  });

  it("derives the static scan prefix from parsed segments", () => {
    const literal = compilePathGlob("src/generated/file.ts");
    assertEquals(literal.staticPrefixSegments, ["src", "generated", "file.ts"]);
    assertEquals(literal.segmentCount, 3);

    const extended = compilePathGlob("src/@(app|pages)/**/*.tsx");
    assertEquals(extended.staticPrefixSegments, ["src"]);
    assertEquals(extended.segmentCount, 4);

    const escaped = compilePathGlob("src/file\\*.ts");
    assertEquals(escaped.staticPrefixSegments, ["src", "file*.ts"]);
  });

  it("rejects malformed and structurally hostile patterns", () => {
    for (
      const pattern of [
        "",
        "file\\",
        "file[abc.ts",
        "file[z-a].ts",
        "file[[:unknown:]].ts",
        "{ts,tsx",
        "@(page|layout",
        "page}.tsx",
        `safe${String.fromCharCode(0)}unsafe`,
      ]
    ) {
      assertThrows(() => compilePathGlob(pattern), TypeError);
    }

    assertThrows(
      () => compilePathGlob(`${"@(a|".repeat(17)}b${")".repeat(17)}`),
      TypeError,
      "nests groups",
    );
    assertThrows(
      () => compilePathGlob(`{${Array.from({ length: 257 }, (_, index) => index).join(",")}}`),
      TypeError,
      "alternatives",
    );
    assertThrows(
      () => compilePathGlob("*a".repeat(257)),
      TypeError,
      "matcher nodes",
    );
    assertThrows(
      () => compilePathGlob("a".repeat(4_097)),
      TypeError,
      "at most 4096",
    );

    const expensiveMatcher = compilePathGlob("*a".repeat(256));
    assertThrows(
      () => expensiveMatcher.test("a".repeat(4_096)),
      TypeError,
      "bounded matching complexity",
    );
  });

  it("rejects hostile candidates instead of treating them as non-matches", () => {
    const matcher = compilePathGlob("**/*.ts");
    assertThrows(() => matcher.test(""), TypeError);
    assertThrows(() => matcher.test(`safe${String.fromCharCode(10)}unsafe.ts`), TypeError);
    assertThrows(() => matcher.test("a".repeat(4_097)), TypeError);
  });
});
