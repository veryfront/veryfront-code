import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { MDXCompiler } from "./mdx.ts";
import type { MDXCacheAdapter, MDXCompilationResult } from "#veryfront/transforms/mdx/index.ts";
import {
  InMemoryBundleManifestStore,
  setBundleManifestStore,
} from "#veryfront/utils/bundle-manifest.ts";

const COMPILED_CODE = "export default function MDXContent() { return null; }";

function makeResult(compiledCode = COMPILED_CODE): MDXCompilationResult {
  return {
    compiledCode,
    frontmatter: {},
    headings: [],
    nodeMap: new Map(),
  };
}

async function sha256Hex(content: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function makeMissAdapter(
  onSetCachedBundle?: () => void,
): MDXCacheAdapter {
  return {
    computeHash: sha256Hex,
    getCachedBundle: (_content: string, _fm?: Record<string, unknown>, _fp?: string) =>
      Promise.resolve(undefined),
    setCachedBundle: (_content: string, _bundle: MDXCompilationResult, _fp?: string) => {
      onSetCachedBundle?.();
      return Promise.resolve();
    },
    invalidateBundle: (_content: string) => Promise.resolve(),
    invalidateSource: (_source: string) => Promise.resolve(0),
    clearAll: () => Promise.resolve(),
    getStats: () => Promise.resolve({ totalBundles: 0, totalSize: 0 }),
  } as unknown as MDXCacheAdapter;
}

describe("rendering/orchestrator/MDXCompiler singleflight", () => {
  beforeEach(() => {
    setBundleManifestStore(new InMemoryBundleManifestStore());
  });

  afterEach(async () => {
    await Promise.resolve();
  });

  describe("concurrent compilations of the same content", () => {
    it("invokes compileAndCache exactly once and both callers receive the result", async () => {
      let setCacheCount = 0;
      let resolveCompile!: (r: MDXCompilationResult) => void;
      const compileGate = new Promise<MDXCompilationResult>((resolve) => {
        resolveCompile = resolve;
      });

      const { register: registerContract } = await import(
        "#veryfront/extensions/contracts.ts"
      );
      registerContract("ContentProcessor", {
        compileMdx: (_opts: Record<string, unknown>) => compileGate,
      });

      const adapter = makeMissAdapter(() => {
        setCacheCount++;
      });

      const compiler = new MDXCompiler({
        projectDir: "/project",
        mode: "production",
        mdxCacheAdapter: adapter,
      });

      const content = "# Concurrent Test";
      const p1 = compiler.compileMDX(content, {}, "test.mdx");
      const p2 = compiler.compileMDX(content, {}, "test.mdx");

      resolveCompile(makeResult());
      const [r1, r2] = await Promise.all([p1, p2]);

      assertEquals(r1.compiledCode, COMPILED_CODE);
      assertEquals(r2.compiledCode, COMPILED_CODE);
      // setCachedBundle called once proves compileAndCache ran once
      assertEquals(setCacheCount, 1);
    });
  });

  describe("after a failed compile, a retry recompiles", () => {
    it("cleans up the in-flight entry on failure so the next call re-runs", async () => {
      let attempt = 0;

      const { register: registerContract } = await import(
        "#veryfront/extensions/contracts.ts"
      );
      registerContract("ContentProcessor", {
        compileMdx: async (): Promise<MDXCompilationResult> => {
          attempt++;
          if (attempt === 1) {
            throw new Error("compile failed");
          }
          return makeResult("retry-result");
        },
      });

      const compiler = new MDXCompiler({
        projectDir: "/project",
        mode: "production",
        mdxCacheAdapter: makeMissAdapter(),
      });

      const content = "# Retry Test";

      await assertRejects(
        () => compiler.compileMDX(content, {}, "retry.mdx"),
        Error,
        "MDX compilation failed",
      );

      const result = await compiler.compileMDX(content, {}, "retry.mdx");
      assertEquals(result.compiledCode, "retry-result");
      assertEquals(attempt, 2);
    });
  });

  describe("different source content compiles independently", () => {
    it("two distinct content strings each invoke compileAndCache once", async () => {
      let compileCount = 0;

      const { register: registerContract } = await import(
        "#veryfront/extensions/contracts.ts"
      );
      registerContract("ContentProcessor", {
        compileMdx: async (opts: Record<string, unknown>): Promise<MDXCompilationResult> => {
          compileCount++;
          return makeResult(`compiled:${opts["content"]}`);
        },
      });

      const compiler = new MDXCompiler({
        projectDir: "/project",
        mode: "production",
        mdxCacheAdapter: makeMissAdapter(),
      });

      const [r1, r2] = await Promise.all([
        compiler.compileMDX("# Page A", {}, "a.mdx"),
        compiler.compileMDX("# Page B", {}, "b.mdx"),
      ]);

      assertEquals(r1.compiledCode, "compiled:# Page A");
      assertEquals(r2.compiledCode, "compiled:# Page B");
      assertEquals(compileCount, 2);
    });
  });
});
