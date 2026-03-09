import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CompilerService } from "./compiler-service.ts";
import type { MdxBundle } from "#veryfront/types";

function createMockBundle(code: string): MdxBundle {
  return {
    compiledCode: code,
    frontmatter: {},
    globals: {},
    headings: [],
    nodeMap: new Map(),
  };
}

describe("rendering/orchestrator/compiler-service", () => {
  describe("CompilerService constructor", () => {
    it("should create an instance", () => {
      const service = new CompilerService();
      assertEquals(service instanceof CompilerService, true);
    });
  });

  describe("compileMDX before setCompileMDX", () => {
    it("should throw when compile function not set", () => {
      const service = new CompilerService();
      assertThrows(
        () => service.compileMDX("# Hello"),
        Error,
      );
    });
  });

  describe("setCompileMDX and compileMDX", () => {
    it("should compile after setting compile function", async () => {
      const service = new CompilerService();
      const mockBundle = createMockBundle("compiled code");

      service.setCompileMDX(async (_content, _fm, _fp) => mockBundle);

      const result = await service.compileMDX("# Hello");
      assertEquals(result.compiledCode, "compiled code");
    });

    it("should pass content, frontmatter, and filePath to compile function", async () => {
      const service = new CompilerService();
      let capturedArgs: {
        content: string;
        frontmatter?: Record<string, unknown>;
        filePath?: string;
      } | null = null;

      service.setCompileMDX(async (content, frontmatter, filePath) => {
        capturedArgs = { content, frontmatter, filePath };
        return createMockBundle("result");
      });

      await service.compileMDX("# Title", { author: "test" }, "/path.mdx");
      assertEquals(capturedArgs!.content, "# Title");
      assertEquals(capturedArgs!.frontmatter, { author: "test" });
      assertEquals(capturedArgs!.filePath, "/path.mdx");
    });

    it("should allow replacing the compile function", async () => {
      const service = new CompilerService();

      service.setCompileMDX(async () => createMockBundle("first"));
      const r1 = await service.compileMDX("test");
      assertEquals(r1.compiledCode, "first");

      service.setCompileMDX(async () => createMockBundle("second"));
      const r2 = await service.compileMDX("test");
      assertEquals(r2.compiledCode, "second");
    });
  });

  describe("getCompileFunction", () => {
    it("should return a bound function", () => {
      const service = new CompilerService();
      const fn = service.getCompileFunction();
      assertEquals(typeof fn, "function");
    });

    it("should throw when called without setCompileMDX", () => {
      const service = new CompilerService();
      const fn = service.getCompileFunction();
      assertThrows(() => fn("test"), Error);
    });

    it("should work after setCompileMDX", async () => {
      const service = new CompilerService();
      service.setCompileMDX(async () => createMockBundle("bound"));
      const fn = service.getCompileFunction();
      const result = await fn("test");
      assertEquals(result.compiledCode, "bound");
    });
  });
});
