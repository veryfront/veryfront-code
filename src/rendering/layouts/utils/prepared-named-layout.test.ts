import "#veryfront/schemas/_test-setup.ts";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { RuntimeModuleReference } from "#veryfront/platform/adapters/base.ts";
import type { MDXCacheAdapter } from "#veryfront/transforms/mdx/index.ts";
import { MDXCompiler } from "#veryfront/rendering/orchestrator/mdx.ts";
import { applyLayoutsESM } from "./applicator.ts";
import { createLayoutComponentCache } from "./component-loader.ts";

describe("prepared named layout bundles", () => {
  it("retains compiler source identity through the named-bundle application path", async () => {
    const cached = { compiledCode: 'throw new Error("Do not evaluate cached source");' };
    const compiler = new MDXCompiler({
      projectDir: "/project",
      mode: "production",
      mdxCacheAdapter: { getCachedBundle: async () => cached } as unknown as MDXCacheAdapter,
    });
    const bundle = await compiler.compileMDX("# Layout", {}, "layouts/frame.mdx");
    const adapter = createMockAdapter();
    const Frame = ({ children }: { children?: React.ReactNode }) =>
      React.createElement("article", null, children);
    Object.defineProperty(adapter, "moduleLoader", {
      value: {
        importModule: async (reference: RuntimeModuleReference) => {
          if (reference.kind === "package" && reference.specifier === "react") {
            return { default: React };
          }
          assertEquals(reference, { kind: "source", path: "/project/layouts/frame.mdx" });
          return { MDXLayout: Frame };
        },
      },
    });
    const result = await applyLayoutsESM(
      React.createElement("main", null, "page"),
      bundle,
      [],
      "/project",
      {},
      createLayoutComponentCache(),
      adapter,
      undefined,
      "project",
      "project",
      "release",
      { compileMode: "production", environment: "production" },
      undefined,
      React.version,
    );
    assertEquals(renderToStaticMarkup(result), "<article><main>page</main></article>");
    assertEquals(
      Object.hasOwn(cached, "sourcePath"),
      false,
      "origin metadata must not mutate shared cached bytes",
    );
  });
});
