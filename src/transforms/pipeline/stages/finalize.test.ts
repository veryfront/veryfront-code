import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { finalizePlugin } from "./finalize.ts";
import {
  type TransformContext,
  TransformStage,
  type TransformTarget,
} from "#veryfront/transforms/pipeline/types.ts";

function createContext(code: string, target: TransformTarget): TransformContext {
  return {
    code,
    originalSource: code,
    filePath: "/project/pages/index.tsx",
    projectDir: "/project",
    projectId: "test",
    target,
    dev: false,
    contentHash: "hash-a",
    jsxImportSource: "react",
    timing: new Map(),
    debug: false,
    metadata: new Map(),
    reactVersion: "19.1.1",
  } as TransformContext;
}

describe("transforms/pipeline/stages/finalize", () => {
  describe("finalizePlugin metadata", () => {
    it("has name 'finalize'", () => {
      assertEquals(finalizePlugin.name, "finalize");
    });

    it("runs at FINALIZE stage", () => {
      assertEquals(finalizePlugin.stage, TransformStage.FINALIZE);
    });

    it("has a transform function", () => {
      assertExists(finalizePlugin.transform);
      assertEquals(typeof finalizePlugin.transform, "function");
    });

    it("has no condition", () => {
      assertEquals(finalizePlugin.condition, undefined);
    });
  });

  describe("finalizePlugin transform", () => {
    const httpImport = `import Player from "https://esm.sh/video.js@8";`;

    it("returns browser code untouched", async () => {
      const ctx = createContext(httpImport, "browser");
      assertEquals(
        await finalizePlugin.transform(ctx),
        httpImport,
        "a non-SSR target must return the code untouched",
      );
    });

    it("normalizes SSR http imports with the context react version", async () => {
      const ctx = createContext(httpImport, "ssr");
      assertEquals(
        await finalizePlugin.transform(ctx),
        `import Player from "https://esm.sh/video.js@8?target=es2022&external=react,react-dom` +
          `&deps=react@19.1.1,react-dom@19.1.1";`,
        "SSR finalize must pin the context react version onto remote http imports",
      );
    });
  });
});
