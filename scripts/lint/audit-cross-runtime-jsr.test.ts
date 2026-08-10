import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  auditCrossRuntimeImports,
  compareAgainstBaseline,
  type CrossRuntimeImport,
  failingRuntimes,
  flattenTsconfigPaths,
  hasFailures,
  isShimmedEverywhere,
  isStdOrJsrSpecifier,
  normalizeStdSpecifier,
  parseStdShimMap,
  resolvesOnBun,
  resolvesOnNode,
  resolveTsconfigPath,
  type RuntimeResolutionContext,
} from "./audit-cross-runtime-jsr.ts";

/**
 * A miniature repo: `#std/path` is shimmed everywhere, `#std/testing/time` is
 * mapped to JSR with no shim, and `#std/fs/walk` has a shim FILE but no
 * tsconfig key (the Node-only trap).
 */
function makeContext(
  overrides: Partial<RuntimeResolutionContext> = {},
): RuntimeResolutionContext {
  const present = new Set([
    "src/platform/compat/std/path.ts",
    "src/platform/compat/std/fs/walk.ts",
  ]);
  return {
    imports: {
      "#std/path": "jsr:@std/path@1.1.4",
      "#std/testing/time": "jsr:@std/testing@1.0.17/time",
      "#std/fs/walk": "jsr:@std/fs@1.0.23/walk",
      "@std/path": "jsr:@std/path@1.1.4",
    },
    nodeStdShims: { "#std/path": "./src/platform/compat/std/path.ts" },
    tsconfigPaths: {
      "#std/path": "./src/platform/compat/std/path.ts",
      "@std/path": "./src/platform/compat/std/path.ts",
      "#veryfront/*": "./src/*",
    },
    fileExists: (path) => present.has(path),
    ...overrides,
  };
}

function importOf(file: string, specifier: string): CrossRuntimeImport {
  return { file, line: 1, specifier };
}

describe("normalizeStdSpecifier", () => {
  it("folds both bare spellings into the #std alias namespace", () => {
    assertEquals(normalizeStdSpecifier("@std/path"), "#std/path");
    assertEquals(normalizeStdSpecifier("std/path"), "#std/path");
    assertEquals(normalizeStdSpecifier("#std/path"), "#std/path");
    assertEquals(normalizeStdSpecifier("#veryfront/utils"), "#veryfront/utils");
  });
});

describe("isStdOrJsrSpecifier", () => {
  it("selects only std aliases and jsr specifiers", () => {
    assertEquals(isStdOrJsrSpecifier("jsr:@std/path@1.1.4"), true);
    assertEquals(isStdOrJsrSpecifier("jsr:@luca/cases"), true);
    assertEquals(isStdOrJsrSpecifier("@std/yaml/parse"), true);
    assertEquals(isStdOrJsrSpecifier("#std/fs"), true);
    assertEquals(isStdOrJsrSpecifier("std/fs"), true);
    assertEquals(isStdOrJsrSpecifier("./relative.ts"), false);
    assertEquals(isStdOrJsrSpecifier("#veryfront/utils"), false);
    assertEquals(isStdOrJsrSpecifier("npm:zod"), false);
  });
});

describe("parseStdShimMap", () => {
  it("reads the literal out of a resolver so the model cannot drift", () => {
    const source = [
      "const before = 1;",
      "const stdImportMap: Record<string, string> = {",
      '  "#std/fs": "./src/platform/compat/std/fs.ts",',
      '  "#std/path": "./src/platform/compat/std/path.ts",',
      "};",
      "const after = 2;",
    ].join("\n");
    assertEquals(parseStdShimMap(source), {
      "#std/fs": "./src/platform/compat/std/fs.ts",
      "#std/path": "./src/platform/compat/std/path.ts",
    });
  });

  it("returns nothing when the literal is missing", () => {
    assertEquals(parseStdShimMap("const other = {};"), {});
  });
});

describe("resolveTsconfigPath", () => {
  it("prefers an exact key over a wildcard", () => {
    const paths = { "#a/b": "./exact.ts", "#a/*": "./wild/*.ts" };
    assertEquals(resolveTsconfigPath(paths, "#a/b"), "./exact.ts");
  });

  it("substitutes the wildcard and takes the longest matching prefix", () => {
    const paths = { "#a/*": "./short/*", "#a/deep/*": "./long/*" };
    assertEquals(resolveTsconfigPath(paths, "#a/deep/x.ts"), "./long/x.ts");
    assertEquals(resolveTsconfigPath(paths, "#a/x.ts"), "./short/x.ts");
  });

  it("keeps the suffix and target from the wildcard that actually matched", () => {
    const paths = {
      "#a/*.js": "./javascript/*.js",
      "#a/*.ts": "./typescript/*.ts",
    };

    assertEquals(resolveTsconfigPath(paths, "#a/x.ts"), "./typescript/x.ts");
  });

  it("returns null for an unmapped specifier", () => {
    assertEquals(resolveTsconfigPath({ "#a/b": "./x.ts" }, "#a/c"), null);
  });
});

describe("flattenTsconfigPaths", () => {
  it("takes the first candidate of each paths entry", () => {
    assertEquals(
      flattenTsconfigPaths({ "#a": ["./one.ts", "./two.ts"], "#b": [] }),
      { "#a": "./one.ts" },
    );
  });
});

describe("resolvesOnNode", () => {
  it("follows a jsr: import-map target to the compat shim", () => {
    assertEquals(resolvesOnNode("#std/path", makeContext()), true);
  });

  it("accepts the src/platform/compat/std convention with no shim entry", () => {
    // Node's `resolveStdCompatTarget` invents this path. Bun does not.
    assertEquals(resolvesOnNode("#std/fs/walk", makeContext()), true);
  });

  it("rejects a specifier with no shim file behind it", () => {
    assertEquals(resolvesOnNode("#std/testing/time", makeContext()), false);
  });

  it("resolves a direct jsr:@std specifier, which Bun cannot", () => {
    assertEquals(resolvesOnNode("jsr:@std/path@1.1.4", makeContext()), true);
  });

  it("rejects a non-std jsr specifier", () => {
    assertEquals(resolvesOnNode("jsr:@luca/cases@1", makeContext()), false);
  });
});

describe("resolvesOnBun", () => {
  it("resolves only through tsconfig paths", () => {
    assertEquals(resolvesOnBun("#std/path", makeContext()), true);
    assertEquals(resolvesOnBun("@std/path", makeContext()), true);
  });

  it("rejects a shim file that has no tsconfig paths key", () => {
    // The file exists and Node finds it by convention; Bun never will.
    assertEquals(resolvesOnBun("#std/fs/walk", makeContext()), false);
  });

  it("does not fold @std into #std the way the runners' maps do", () => {
    const context = makeContext({
      tsconfigPaths: { "#std/path": "./src/platform/compat/std/path.ts" },
    });
    assertEquals(resolvesOnBun("#std/path", context), true);
    assertEquals(resolvesOnBun("@std/path", context), false);
  });

  it("rejects every jsr: specifier, shimmed alias or not", () => {
    // The regression this audit exists for: `#std/path` is fully shimmed, and
    // the jsr: spelling of the same module is still unresolvable on Bun.
    assertEquals(resolvesOnBun("jsr:@std/path@1.1.4", makeContext()), false);
  });

  it("rejects a deno.json-only local mapping", () => {
    const context = makeContext({
      imports: { "#std/only-deno": "./src/platform/compat/std/path.ts" },
      tsconfigPaths: {},
    });
    assertEquals(resolvesOnBun("#std/only-deno", context), false);
  });
});

describe("isShimmedEverywhere", () => {
  it("takes the stricter of the two runtimes", () => {
    const context = makeContext();
    assertEquals(isShimmedEverywhere("#std/path", context), true);
    // Node yes, Bun no.
    assertEquals(isShimmedEverywhere("#std/fs/walk", context), false);
    assertEquals(isShimmedEverywhere("#std/testing/time", context), false);
  });
});

describe("failingRuntimes", () => {
  it("names the runtime that actually breaks", () => {
    const context = makeContext();
    assertEquals(failingRuntimes("#std/fs/walk", context), ["Bun"]);
    assertEquals(failingRuntimes("#std/testing/time", context), [
      "Node",
      "Bun",
    ]);
    assertEquals(failingRuntimes("jsr:@std/path@1.1.4", context), ["Bun"]);
    assertEquals(failingRuntimes("#std/path", context), []);
  });
});

describe("auditCrossRuntimeImports", () => {
  it("flags a direct jsr: import even when the #std alias is shimmed", () => {
    const audit = auditCrossRuntimeImports(
      [importOf("src/a.ts", "jsr:@std/path@1.1.4")],
      makeContext(),
    );
    assertEquals(audit.directJsrImports.length, 1);
    assertEquals(audit.directJsrImports[0].file, "src/a.ts");
    assertEquals(audit.unshimmedDependents.size, 0);
  });

  it("ignores shimmed specifiers and out-of-scope imports", () => {
    const audit = auditCrossRuntimeImports(
      [
        importOf("src/a.ts", "#std/path"),
        importOf("src/a.ts", "./local.ts"),
        importOf("src/a.ts", "npm:zod"),
      ],
      makeContext(),
    );
    assertEquals(audit.directJsrImports.length, 0);
    assertEquals(audit.unshimmedDependents.size, 0);
  });

  it("collects unique dependent files per unshimmed specifier", () => {
    const audit = auditCrossRuntimeImports(
      [
        importOf("src/b.ts", "#std/testing/time"),
        importOf("src/a.ts", "#std/testing/time"),
        importOf("src/a.ts", "#std/testing/time"),
      ],
      makeContext(),
    );
    assertEquals(audit.unshimmedDependents.get("#std/testing/time"), [
      "src/a.ts",
      "src/b.ts",
    ]);
  });
});

describe("compareAgainstBaseline", () => {
  const context = makeContext();

  it("passes when the dependent count matches the baseline", () => {
    const audit = auditCrossRuntimeImports(
      [importOf("src/a.ts", "#std/testing/time")],
      context,
    );
    const comparison = compareAgainstBaseline(
      audit,
      { "#std/testing/time": 1 },
      context,
    );
    assertEquals(hasFailures(comparison), false);
  });

  it("fails when a baselined specifier gains a dependent", () => {
    // The hole a mapping-count ratchet leaves open: no NEW specifier, one new
    // broken Node/Bun test file.
    const audit = auditCrossRuntimeImports(
      [
        importOf("src/a.ts", "#std/testing/time"),
        importOf("src/b.ts", "#std/testing/time"),
      ],
      context,
    );
    const comparison = compareAgainstBaseline(
      audit,
      { "#std/testing/time": 1 },
      context,
    );
    assertEquals(hasFailures(comparison), true);
    assertEquals(comparison.grown.length, 1);
    assertEquals(comparison.grown[0].current, 2);
    assertEquals(comparison.grown[0].baseline, 1);
  });

  it("fails on an unshimmed specifier that has no baseline entry", () => {
    const audit = auditCrossRuntimeImports(
      [importOf("src/a.ts", "#std/fs/walk")],
      context,
    );
    const comparison = compareAgainstBaseline(audit, {}, context);
    assertEquals(hasFailures(comparison), true);
    assertEquals(comparison.newSpecifiers[0].specifier, "#std/fs/walk");
  });

  it("fails when a baseline shrinks until the lower count is recorded", () => {
    const audit = auditCrossRuntimeImports(
      [importOf("src/a.ts", "#std/testing/time")],
      context,
    );
    const comparison = compareAgainstBaseline(
      audit,
      { "#std/testing/time": 3 },
      context,
    );
    assertEquals(hasFailures(comparison), true);
    assertEquals(comparison.shrunk, [{
      specifier: "#std/testing/time",
      baseline: 3,
      current: 1,
    }]);
  });

  it("fails on stale baselines while distinguishing shimmed from unused", () => {
    // #std/path resolves on both runtimes; #std/testing/time does not and is
    // simply unused. Collapsing these two into one message sends the reader
    // looking for a shim that was never written.
    const comparison = compareAgainstBaseline(
      auditCrossRuntimeImports([], context),
      { "#std/path": 2, "#std/testing/time": 2 },
      context,
    );
    assertEquals(comparison.staleShimmed, ["#std/path"]);
    assertEquals(comparison.staleUnused, ["#std/testing/time"]);
    assertEquals(hasFailures(comparison), true);
  });
});
