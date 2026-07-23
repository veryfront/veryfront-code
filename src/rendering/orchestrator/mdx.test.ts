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
  identityScope = "test-scope",
): MDXCacheAdapter {
  const adapter = {
    computeHash: sha256Hex,
    computeCompilationIdentity: async (
      content: string,
      frontmatter?: Record<string, unknown>,
      filePath?: string,
      studioEmbed?: boolean,
    ) =>
      JSON.stringify([
        identityScope,
        await adapter.computeHash(content),
        frontmatter ?? {},
        filePath ?? null,
        studioEmbed ?? false,
      ]),
    getCachedBundle: (
      _content: string,
      _fm?: Record<string, unknown>,
      _fp?: string,
      _studioEmbed?: boolean,
    ) => Promise.resolve(undefined),
    setCachedBundle: (
      _content: string,
      _bundle: MDXCompilationResult,
      _fp?: string,
      _fm?: Record<string, unknown>,
      _studioEmbed?: boolean,
    ) => {
      onSetCachedBundle?.();
      return Promise.resolve();
    },
    invalidateBundle: (_content: string) => Promise.resolve(),
    invalidateSource: (_source: string) => Promise.resolve(0),
    clearAll: () => Promise.resolve(),
    getStats: () => Promise.resolve({ totalBundles: 0, totalSize: 0 }),
  };
  return adapter as unknown as MDXCacheAdapter;
}

describe("rendering/orchestrator/MDXCompiler singleflight", () => {
  beforeEach(() => {
    setBundleManifestStore(new InMemoryBundleManifestStore());
  });

  afterEach(async () => {
    // Drop the stubbed ContentProcessor so it cannot leak into other test
    // files that share this worker process.
    const { unregister } = await import("#veryfront/extensions/contracts.ts");
    unregister("ContentProcessor");
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
        cacheIdentity: "test-content-processor@1",
        resultIsolation: "structured-clone",
        compileMdx: (_opts: Record<string, unknown>) => compileGate,
      });

      const adapter = makeMissAdapter(() => {
        setCacheCount++;
      });

      // Hold both callers at computeHash until BOTH have arrived, so they
      // reach the singleflight map while the compile is still in flight.
      // Without this the test races: under load the first caller can finish
      // its whole compile before the second reaches the flight map, and the
      // second then compiles again legitimately.
      let hashCalls = 0;
      let releaseHashes!: () => void;
      const bothHashing = new Promise<void>((resolve) => {
        releaseHashes = resolve;
      });
      adapter.computeHash = async (_content: string) => {
        hashCalls++;
        if (hashCalls >= 2) releaseHashes();
        await bothHashing;
        // A fixed hash, NOT sha256Hex: real crypto.subtle work runs on a
        // thread pool with unbounded latency, so under CI load one caller
        // could still finish its whole compile before the other left this
        // function — re-introducing the race the gate above exists to close.
        // After this synchronous return both callers reach the flight map
        // within their own microtask, before the test's macrotask resolves
        // the compile.
        return "fixed-concurrent-test-hash";
      };

      const compiler = new MDXCompiler({
        projectDir: "/project",
        mode: "production",
        mdxCacheAdapter: adapter,
      });

      const content = "# Concurrent Test";
      const p1 = compiler.compileMDX(content, {}, "test.mdx");
      const p2 = compiler.compileMDX(content, {}, "test.mdx");

      // Both callers are now past computeHash; drain a macrotask so both
      // enter compileFlight.do() before the compile resolves.
      await bothHashing;
      await new Promise((resolve) => setTimeout(resolve, 0));
      resolveCompile(makeResult());
      const [r1, r2] = await Promise.all([p1, p2]);

      assertEquals(r1.compiledCode, COMPILED_CODE);
      assertEquals(r2.compiledCode, COMPILED_CODE);
      assertEquals(r1 === r2, false);
      // setCachedBundle called once proves compileAndCache ran once
      assertEquals(setCacheCount, 1);
    });

    it("returns detached mutable results to concurrent callers", async () => {
      let resolveCompile!: (r: MDXCompilationResult) => void;
      const compileGate = new Promise<MDXCompilationResult>((resolve) => {
        resolveCompile = resolve;
      });
      const { register: registerContract } = await import(
        "#veryfront/extensions/contracts.ts"
      );
      registerContract("ContentProcessor", {
        cacheIdentity: "test-content-processor@1",
        resultIsolation: "structured-clone",
        compileMdx: () => compileGate,
      });

      const compiler = new MDXCompiler({
        projectDir: "/project",
        mode: "production",
        mdxCacheAdapter: makeMissAdapter(),
      });
      const firstPromise = compiler.compileMDX("# Detached", {}, "detached.mdx");
      const secondPromise = compiler.compileMDX("# Detached", {}, "detached.mdx");
      await new Promise((resolve) => setTimeout(resolve, 0));
      resolveCompile({
        ...makeResult(),
        frontmatter: { tags: ["original"] },
        nodeMap: new Map([[1, { line: 1 }]]),
      });

      const [first, second] = await Promise.all([firstPromise, secondPromise]);
      (first.frontmatter!.tags as string[])[0] = "mutated";
      (first.nodeMap!.get(1) as { line: number }).line = 99;

      assertEquals(second.frontmatter, { tags: ["original"] });
      assertEquals(second.nodeMap?.get(1), { line: 1 });
    });

    it("does not coalesce identical content compiled from different file paths", async () => {
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

      // Same source in two locations: relative imports resolve differently,
      // so the compiles must NOT share an in-flight promise.
      const content = "# Same Source";
      const p1 = compiler.compileMDX(content, {}, "docs/a/page.mdx");
      const p2 = compiler.compileMDX(content, {}, "docs/b/page.mdx");

      resolveCompile(makeResult());
      await Promise.all([p1, p2]);

      assertEquals(setCacheCount, 2);
    });

    it("does not coalesce identical inputs across adapter scopes", async () => {
      let compileCount = 0;
      let resolveCompile!: (result: MDXCompilationResult) => void;
      const compileGate = new Promise<MDXCompilationResult>((resolve) => {
        resolveCompile = resolve;
      });

      const { register: registerContract } = await import(
        "#veryfront/extensions/contracts.ts"
      );
      registerContract("ContentProcessor", {
        compileMdx: () => {
          compileCount++;
          return compileGate;
        },
      });

      const first = new MDXCompiler({
        projectDir: "/project",
        mode: "production",
        mdxCacheAdapter: makeMissAdapter(undefined, "project-a"),
      });
      const second = new MDXCompiler({
        projectDir: "/project",
        mode: "production",
        mdxCacheAdapter: makeMissAdapter(undefined, "project-b"),
      });

      const p1 = first.compileMDX("# Shared", {}, "index.mdx");
      const p2 = second.compileMDX("# Shared", {}, "index.mdx");
      await new Promise((resolve) => setTimeout(resolve, 0));
      resolveCompile(makeResult());
      await Promise.all([p1, p2]);

      assertEquals(compileCount, 2);
    });
  });

  describe("Studio compilation", () => {
    it("forwards studioEmbed to the content processor", async () => {
      let receivedStudioEmbed: unknown;
      const { register: registerContract } = await import(
        "#veryfront/extensions/contracts.ts"
      );
      registerContract("ContentProcessor", {
        compileMdx: (options: Record<string, unknown>) => {
          receivedStudioEmbed = options["studioEmbed"];
          return Promise.resolve(makeResult());
        },
      });

      const compiler = new MDXCompiler({
        projectDir: "/project",
        mode: "development",
        mdxCacheAdapter: makeMissAdapter(),
        studioEmbed: true,
      });

      await compiler.compileMDX("# Studio", {}, "studio.mdx");
      assertEquals(receivedStudioEmbed, true);
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
