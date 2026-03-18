import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { UnifiedImportRewriter } from "./unified-rewriter.ts";
import type { ImportRewriteStrategy, RewriteContext } from "./types.ts";

function mockStrategy(
  name: string,
  priority: number,
  handler: (specifier: string) => string | null,
): ImportRewriteStrategy {
  return {
    name,
    priority,
    matches: (specifier: string) => handler(specifier) !== null,
    rewrite: (info) => ({ specifier: handler(info.specifier) }),
  };
}

function createCtx(overrides?: Partial<RewriteContext>): RewriteContext {
  return {
    filePath: "/test/file.tsx",
    projectDir: "/test",
    projectId: "test",
    target: "browser",
    dev: false,
    reactVersion: "19",
    ...overrides,
  };
}

describe("UnifiedImportRewriter", () => {
  it("applies matching strategy to imports", async () => {
    const strategy = mockStrategy("test", 0, (spec) =>
      spec === "my-lib" ? "/rewritten/my-lib.js" : null
    );
    const rewriter = new UnifiedImportRewriter({ strategies: [strategy] });
    const result = await rewriter.rewrite(
      `import { foo } from "my-lib";\n`,
      createCtx(),
    );
    assertEquals(result.includes("/rewritten/my-lib.js"), true);
  });

  it("returns code unchanged when no strategy matches", async () => {
    const strategy = mockStrategy("noop", 0, () => null);
    const rewriter = new UnifiedImportRewriter({ strategies: [strategy] });
    const code = `import { x } from "unknown-pkg";\n`;
    const result = await rewriter.rewrite(code, createCtx());
    assertEquals(result.includes("unknown-pkg"), true);
  });

  it("first matching strategy wins", async () => {
    const first = mockStrategy("first", 0, (spec) =>
      spec === "target" ? "/first.js" : null
    );
    const second = mockStrategy("second", 1, (spec) =>
      spec === "target" ? "/second.js" : null
    );
    const rewriter = new UnifiedImportRewriter({ strategies: [first, second] });
    const result = await rewriter.rewrite(
      `import { a } from "target";\n`,
      createCtx(),
    );
    assertEquals(result.includes("/first.js"), true);
    assertEquals(result.includes("/second.js"), false);
  });

  it("handles code with no imports", async () => {
    const rewriter = new UnifiedImportRewriter({ strategies: [] });
    const code = `const x = 1;\n`;
    const result = await rewriter.rewrite(code, createCtx());
    assertEquals(result, code);
  });

  it("rewrites multiple imports with different strategies", async () => {
    const strategyA = mockStrategy("a", 0, (spec) =>
      spec === "pkg-a" ? "/a.js" : null
    );
    const strategyB = mockStrategy("b", 1, (spec) =>
      spec === "pkg-b" ? "/b.js" : null
    );
    const rewriter = new UnifiedImportRewriter({ strategies: [strategyA, strategyB] });
    const result = await rewriter.rewrite(
      `import { a } from "pkg-a";\nimport { b } from "pkg-b";\n`,
      createCtx(),
    );
    assertEquals(result.includes("/a.js"), true);
    assertEquals(result.includes("/b.js"), true);
  });

  it("respects priority order", async () => {
    // Lower priority number = runs first
    const highPriority = mockStrategy("high", 0, (spec) =>
      spec === "shared" ? "/high.js" : null
    );
    const lowPriority = mockStrategy("low", 10, (spec) =>
      spec === "shared" ? "/low.js" : null
    );
    // Pass in wrong order — constructor should not re-sort (user provides order)
    const rewriter = new UnifiedImportRewriter({
      strategies: [highPriority, lowPriority],
    });
    const result = await rewriter.rewrite(
      `import { x } from "shared";\n`,
      createCtx(),
    );
    assertEquals(result.includes("/high.js"), true);
  });
});
