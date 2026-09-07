import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { VeryfrontError } from "#veryfront/errors";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { RuntimeModuleReference } from "#veryfront/platform/adapters/base.ts";
import { MDXRenderer } from "./index.ts";

describe("prepared MDX modules", () => {
  it("retains the layout alias emitted by older prepared modules", async () => {
    const Layout = () => null;
    const Content = () => null;
    const adapter = createMockAdapter();
    Object.defineProperty(adapter, "moduleLoader", {
      value: {
        importModule: async () => ({ default: Content, __vfLayout: Layout }),
      },
    });
    const renderer = new MDXRenderer();
    try {
      const module = await renderer.loadModuleESM("", {
        adapter,
        sourcePath: "/project/layout.mdx",
      });
      assertStrictEquals(module.MDXLayout, Layout);
      assertStrictEquals(module.default, Content);
    } finally {
      renderer.clearCache();
    }
  });
  it("requires source identity and imports the prepared module without evaluating inline code", async () => {
    const module = { default: () => null };
    const references: RuntimeModuleReference[] = [];
    const adapter = createMockAdapter();
    Object.defineProperty(adapter, "moduleLoader", {
      value: {
        importModule: async (reference: RuntimeModuleReference) => {
          references.push(reference);
          return module;
        },
      },
    });
    const renderer = new MDXRenderer();
    try {
      const error = await assertRejects(
        () => renderer.loadModuleESM("export default 1;", { adapter }),
        Error,
        "sourcePath",
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "invalid-argument");
      assertStrictEquals(
        await renderer.loadModuleESM('throw new Error("not prepared");', {
          adapter,
          sourcePath: "/project/app/page.mdx",
        }),
        module,
      );
      assertEquals(references, [{ kind: "source", path: "/project/app/page.mdx" }]);
    } finally {
      renderer.clearCache();
    }
  });
});
