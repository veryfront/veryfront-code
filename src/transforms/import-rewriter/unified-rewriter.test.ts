import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join, toFileUrl } from "#veryfront/compat/path/index.ts";
import { rewriteImports, UnifiedImportRewriter } from "./unified-rewriter.ts";
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
    const strategy = mockStrategy(
      "test",
      0,
      (spec) => spec === "my-lib" ? "/rewritten/my-lib.js" : null,
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
    const first = mockStrategy("first", 0, (spec) => spec === "target" ? "/first.js" : null);
    const second = mockStrategy("second", 1, (spec) => spec === "target" ? "/second.js" : null);
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
    const strategyA = mockStrategy("a", 0, (spec) => spec === "pkg-a" ? "/a.js" : null);
    const strategyB = mockStrategy("b", 1, (spec) => spec === "pkg-b" ? "/b.js" : null);
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
    const highPriority = mockStrategy("high", 0, (spec) => spec === "shared" ? "/high.js" : null);
    const lowPriority = mockStrategy("low", 10, (spec) => spec === "shared" ? "/low.js" : null);
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

describe("rewriteImports with the default strategies", () => {
  function defaultCtx(overrides?: Partial<RewriteContext>): RewriteContext {
    return createCtx({ filePath: "/test/pages/index.tsx", ...overrides });
  }

  async function loadTransformedProjectModule(
    source: string,
    suffix: string,
  ): Promise<{ load(): Promise<{ default?: unknown }> }> {
    const transformed = await rewriteImports(source, defaultCtx({ target: "ssr" }));
    const directory = await Deno.makeTempDir({ prefix: "vf-computed-import-" });
    const modulePath = join(directory, "project-module.mjs");

    try {
      await Deno.writeTextFile(modulePath, transformed);
      return await import(`${toFileUrl(modulePath).href}?${suffix}`);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  }

  it("rejects a static asset import", async () => {
    const error = await assertRejects(
      () =>
        rewriteImports(
          `import logo from "@/assets/logo.svg";\n`,
          defaultCtx(),
        ),
      Error,
    );

    assertInstanceOf(error, Error);
    assertStringIncludes(error.message, "@/assets/logo.svg");
    assertStringIncludes(error.message, "public/logo.svg");
  });

  it("still rewrites a code import through the alias strategy", async () => {
    const result = await rewriteImports(
      `import Button from "@/components/Button";\n`,
      defaultCtx(),
    );

    assertStringIncludes(result, "../components/Button.js");
  });

  it("preserves versioned cross-project imports for SSR loader replacement", async () => {
    const code = `import Button from "demo@1.0.0/@/components/Button";\n`;
    const result = await rewriteImports(code, defaultCtx({ target: "ssr" }));

    assertEquals(result, code);
  });

  it("rejects a computed internal framework import before native resolution", async () => {
    const projectModule = await loadTransformedProjectModule(
      [
        `const target = "#veryfront/agent/hosted/internal/control-plane-mcp-source.ts";`,
        `export const load = () => import(target);`,
      ].join("\n"),
      "internal-alias",
    );
    const error = await assertRejects(
      () => Promise.resolve().then(() => projectModule.load()),
      Error,
    );

    assertInstanceOf(error, Error);
    assertStringIncludes(error.message, "Computed #veryfront imports must use a string literal");
  });

  it("rejects guarded computed imports through the native import promise", async () => {
    const projectModule = await loadTransformedProjectModule(
      [
        `const target = "#veryfront/agent/hosted/internal/control-plane-mcp-source.ts";`,
        `export const load = () => import(target);`,
      ].join("\n"),
      "native-rejection-semantics",
    );
    let result: Promise<{ default?: unknown }> | undefined;
    let synchronousError: unknown;

    try {
      result = projectModule.load();
    } catch (error) {
      synchronousError = error;
    }

    assertEquals(synchronousError, undefined);
    assertInstanceOf(result, Promise);
    const error = await assertRejects(
      () => result!,
      TypeError,
    );
    assertInstanceOf(error, Error);
    assertStringIncludes(error.message, "Computed #veryfront imports must use a string literal");
  });

  it("rejects a concatenated internal transport import before native resolution", async () => {
    const projectModule = await loadTransformedProjectModule(
      [
        `const target = "#veryfront/tool/" + "internal/remote-mcp-transport.ts";`,
        `export const load = () => import(target);`,
      ].join("\n"),
      "concatenated-alias",
    );
    const error = await assertRejects(
      () => Promise.resolve().then(() => projectModule.load()),
      Error,
    );

    assertInstanceOf(error, Error);
    assertStringIncludes(error.message, "Computed #veryfront imports must use a string literal");
  });

  it("rejects a computed framework file URL before native resolution", async () => {
    const projectModule = await loadTransformedProjectModule(
      [
        `const target = import.meta.resolve("#veryfront/agent/hosted/internal/control-plane-mcp-source.ts");`,
        `export const load = () => import(target);`,
      ].join("\n"),
      "resolved-file-url",
    );
    const error = await assertRejects(
      () => Promise.resolve().then(() => projectModule.load()),
      Error,
    );

    assertInstanceOf(error, Error);
    assertStringIncludes(error.message, "Computed framework imports must use a string literal");
  });

  it("preserves ordinary computed dynamic imports", async () => {
    const projectModule = await loadTransformedProjectModule(
      [
        `const target = "data:text/javascript,export default 42";`,
        `export const load = () => import(target);`,
      ].join("\n"),
      "computed-public",
    );

    assertEquals((await projectModule.load()).default, 42);
  });

  it("leaves an asset inside a dependency to the bare strategy", async () => {
    // The extension alone must not claim the specifier: "move the file to
    // public/" is not something you can do to a file inside node_modules.
    const result = await rewriteImports(
      `import markerIcon from "leaflet/dist/images/marker-icon.png";\n`,
      defaultCtx(),
    );

    assertStringIncludes(result, "marker-icon.png");
  });

  it("leaves a remote asset URL to the url strategy", async () => {
    const result = await rewriteImports(
      `import logo from "https://cdn.example.com/icons/logo.svg";\n`,
      defaultCtx(),
    );

    assertStringIncludes(result, "https://cdn.example.com/icons/logo.svg");
  });
});
