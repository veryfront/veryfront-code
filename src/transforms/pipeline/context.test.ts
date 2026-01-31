import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createTransformContextSync,
  formatTimingLog,
  getTotalTiming,
  isBrowser,
  isMDX,
  isSSR,
  isTypeScript,
  recordStageTiming,
} from "./context.ts";
import type { TransformContext } from "./types.ts";

function makeContext(overrides: Partial<TransformContext> = {}): TransformContext {
  return {
    code: "const x = 1;",
    originalSource: "const x = 1;",
    filePath: "/project/pages/index.tsx",
    projectDir: "/project",
    projectId: "test-project",
    target: "browser",
    dev: true,
    contentHash: "abc12345",
    jsxImportSource: "react",
    timing: new Map(),
    debug: false,
    metadata: new Map(),
    reactVersion: "19.1.1",
    ...overrides,
  };
}

describe("transforms/pipeline/context", () => {
  describe("createTransformContextSync", () => {
    it("should create context with browser target when ssr is false", () => {
      const ctx = createTransformContextSync("code", "/file.tsx", "/project", "hash", {
        projectId: "test",
        ssr: false,
      });

      assertEquals(ctx.target, "browser");
      assertEquals(ctx.code, "code");
      assertEquals(ctx.filePath, "/file.tsx");
    });

    it("should create context with ssr target when ssr is true", () => {
      const ctx = createTransformContextSync("code", "/file.tsx", "/project", "hash", {
        projectId: "test",
        ssr: true,
      });

      assertEquals(ctx.target, "ssr");
    });

    it("should default dev to true", () => {
      const ctx = createTransformContextSync("code", "/file.tsx", "/project", "hash", {
        projectId: "test",
      });

      assertEquals(ctx.dev, true);
    });

    it("should use provided reactVersion", () => {
      const ctx = createTransformContextSync("code", "/file.tsx", "/project", "hash", {
        projectId: "test",
        reactVersion: "18.3.1",
      });

      assertEquals(ctx.reactVersion, "18.3.1");
    });

    it("should default jsxImportSource to react", () => {
      const ctx = createTransformContextSync("code", "/file.tsx", "/project", "hash", {
        projectId: "test",
      });

      assertEquals(ctx.jsxImportSource, "react");
    });
  });

  describe("recordStageTiming", () => {
    it("should record timing for a stage", () => {
      const ctx = makeContext();
      const start = performance.now() - 5;

      recordStageTiming(ctx, 0, start);

      assertEquals(ctx.timing.has(0), true);
      assertEquals((ctx.timing.get(0) ?? 0) > 0, true);
    });
  });

  describe("getTotalTiming", () => {
    it("should sum all stage timings", () => {
      const ctx = makeContext();
      ctx.timing.set(0, 10);
      ctx.timing.set(1, 20);
      ctx.timing.set(2, 30);

      assertEquals(getTotalTiming(ctx), 60);
    });

    it("should return 0 for empty timing", () => {
      assertEquals(getTotalTiming(makeContext()), 0);
    });
  });

  describe("formatTimingLog", () => {
    it("should include file and target", () => {
      const log = formatTimingLog(makeContext());

      assertEquals(typeof log.file, "string");
      assertEquals(log.target, "browser");
    });

    it("should include totalMs", () => {
      const ctx = makeContext();
      ctx.timing.set(0, 10.5);

      const log = formatTimingLog(ctx);

      assertEquals(log.totalMs, "10.5");
    });

    it("should name known stages", () => {
      const ctx = makeContext();
      ctx.timing.set(0, 5);
      ctx.timing.set(1, 3);

      const log = formatTimingLog(ctx);

      assertEquals(log.parseMs, "5.0");
      assertEquals(log.compileMs, "3.0");
    });
  });

  describe("isSSR", () => {
    it("should return true for ssr target", () => {
      assertEquals(isSSR(makeContext({ target: "ssr" })), true);
    });

    it("should return false for browser target", () => {
      assertEquals(isSSR(makeContext({ target: "browser" })), false);
    });
  });

  describe("isBrowser", () => {
    it("should return true for browser target", () => {
      assertEquals(isBrowser(makeContext({ target: "browser" })), true);
    });

    it("should return false for ssr target", () => {
      assertEquals(isBrowser(makeContext({ target: "ssr" })), false);
    });
  });

  describe("isMDX", () => {
    it("should return true for .mdx files", () => {
      assertEquals(isMDX(makeContext({ filePath: "/project/post.mdx" })), true);
    });

    it("should return true for .md files", () => {
      assertEquals(isMDX(makeContext({ filePath: "/project/readme.md" })), true);
    });

    it("should return false for .tsx files", () => {
      assertEquals(isMDX(makeContext({ filePath: "/project/page.tsx" })), false);
    });
  });

  describe("isTypeScript", () => {
    it("should return true for .ts files", () => {
      assertEquals(isTypeScript(makeContext({ filePath: "/project/utils.ts" })), true);
    });

    it("should return true for .tsx files", () => {
      assertEquals(isTypeScript(makeContext({ filePath: "/project/page.tsx" })), true);
    });

    it("should return false for .js files", () => {
      assertEquals(isTypeScript(makeContext({ filePath: "/project/main.js" })), false);
    });
  });
});
