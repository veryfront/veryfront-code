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
