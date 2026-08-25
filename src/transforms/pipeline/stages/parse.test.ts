import "#veryfront/schemas/_test-setup.ts";
import "../../mdx/compiler/__tests__/content-processor-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parsePlugin } from "./parse.ts";
import { TransformStage } from "../types.ts";
import type { TransformContext, TransformTarget } from "../types.ts";
import { isMDX } from "../context.ts";

const MDX_SOURCE = `import { Button } from "@/components/Button";\n\n# Hello\n\n<Button />\n`;

function createMdxContext(target: TransformTarget): TransformContext {
  return {
    code: MDX_SOURCE,
    originalSource: MDX_SOURCE,
    filePath: "/project/pages/post.mdx",
    projectDir: "/project",
    projectId: "test",
    target,
    dev: false,
    contentHash: "hash-a",
    moduleServerUrl: "http://localhost:3001",
    jsxImportSource: "react",
    timing: new Map(),
    debug: false,
    metadata: new Map(),
    reactVersion: "19.1.1",
  } as TransformContext;
}

describe("transforms/pipeline/stages/parse", () => {
  describe("parsePlugin metadata", () => {
    it("has name 'parse-mdx'", () => {
      assertEquals(parsePlugin.name, "parse-mdx");
    });

    it("runs at PARSE stage", () => {
      assertEquals(parsePlugin.stage, TransformStage.PARSE);
    });

    it("has a transform function", () => {
      assertExists(parsePlugin.transform);
      assertEquals(typeof parsePlugin.transform, "function");
    });

    it("has condition set to isMDX", () => {
      assertEquals(parsePlugin.condition, isMDX);
    });
  });

  describe("parsePlugin transform", () => {
    it("compiles browser MDX through the module server", async () => {
      const result = await parsePlugin.transform(createMdxContext("browser"));
      assertStringIncludes(
        result,
        `"http://localhost:3001/_vf_modules/components/Button.js"`,
        "browser MDX compile must rewrite @/ through the module server",
      );
    });

    it("compiles SSR MDX with the server target", async () => {
      const result = await parsePlugin.transform(createMdxContext("ssr"));
      assertStringIncludes(
        result,
        `"@/components/Button"`,
        "SSR MDX compile must use the server target, which leaves @/ specifiers for the SSR resolver",
      );
      assertEquals(
        result.includes("http://localhost:3001"),
        false,
        "module-server URLs must not be baked into SSR output",
      );
    });
  });
});
