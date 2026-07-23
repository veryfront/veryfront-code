import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  register as registerContract,
  reset as resetContracts,
  tryResolve as tryResolveContract,
} from "#veryfront/extensions/contracts.ts";
import type { CSSProcessor } from "#veryfront/extensions/css/index.ts";
import {
  generateTailwindCSS,
  getCompilerCacheStats,
  invalidateCompiler,
} from "./tailwind-compiler.ts";
import { getCompiler } from "./tailwind-compiler-cache.ts";

const MOCK_TAILWIND_BASE_CSS = "@layer theme, base, components, utilities;";

function mockTailwindFetch(): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: URL | Request | string) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;

    if (!url.includes("tailwindcss")) {
      return Promise.reject(new Error(`Unexpected fetch URL during test: ${url}`));
    }

    return Promise.resolve(new Response(MOCK_TAILWIND_BASE_CSS, { status: 200 }));
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe("styles-builder/tailwind default CSSProcessor", () => {
  let restoreFetch: (() => void) | undefined;

  beforeEach(() => {
    resetContracts();
    invalidateCompiler();
    restoreFetch = mockTailwindFetch();
  });

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
    resetContracts();
    invalidateCompiler();
  });

  it("fails closed when the Tailwind base stylesheet cannot be fetched", async () => {
    restoreFetch?.();
    globalThis.fetch =
      (() => Promise.reject(new Error("sensitive upstream detail"))) as typeof fetch;

    const result = await generateTailwindCSS(
      '@import "tailwindcss";/*vf-base-fetch-failure*/',
      ["text-red-500"],
      { projectSlug: "vf-base-fetch-failure" },
    );

    assertEquals(typeof result.error, "string");
    assertEquals(result.css, "");
    assertEquals(result.error?.includes("sensitive upstream detail"), false);
  });

  it("cancels an oversized streamed Tailwind stylesheet before consuming the remainder", async () => {
    restoreFetch?.();
    let pullCount = 0;
    let cancelled = false;
    globalThis.fetch = (() => {
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pullCount++;
          if (pullCount <= 8) {
            controller.enqueue(new Uint8Array(1024 * 1024));
          } else {
            controller.close();
          }
        },
        cancel() {
          cancelled = true;
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    }) as typeof fetch;

    const result = await generateTailwindCSS(
      '@import "tailwindcss";/*vf-base-stream-limit*/',
      ["text-red-500"],
      { projectSlug: "vf-base-stream-limit" },
    );

    assertEquals(typeof result.error, "string");
    assertEquals(cancelled, true);
    assertEquals(pullCount < 9, true);
  });

  it("uses the built-in Tailwind processor when no project extension registered one", async () => {
    const result = await generateTailwindCSS(
      '@import "tailwindcss";/*vf-default-css-processor*/',
      ["text-red-500"],
      { minify: true, projectSlug: "vf-default-css-processor" },
    );

    assertEquals(result.error, undefined);
    assertEquals(tryResolveContract<CSSProcessor>("CSSProcessor") !== undefined, true);
  });

  it("single-flights concurrent compiler creation for the same project stylesheet", async () => {
    let compileCount = 0;
    const processor: CSSProcessor = {
      async compile() {
        compileCount++;
        await Promise.resolve();
        return { build: () => ".compiled{}" };
      },
    };
    registerContract("CSSProcessor", processor);

    const [first, second] = await Promise.all([
      getCompiler('@import "tailwindcss";/*single-flight*/', "same-project"),
      getCompiler('@import "tailwindcss";/*single-flight*/', "same-project"),
    ]);

    assertEquals(compileCount, 1);
    assertEquals(first, second);
  });

  it("keeps invalidated compiler initializations in the concurrency budget", async () => {
    const releaseCompilers: Array<() => void> = [];
    let compileCount = 0;
    let signalAllStarted: (() => void) | undefined;
    const allStarted = new Promise<void>((resolve) => {
      signalAllStarted = resolve;
    });
    const processor: CSSProcessor = {
      compile() {
        compileCount++;
        if (compileCount > 16) {
          return Promise.resolve({ build: () => ".unexpected{}" });
        }
        if (compileCount === 16) signalAllStarted?.();
        return new Promise((resolve) => {
          releaseCompilers.push(() => resolve({ build: () => ".compiled{}" }));
        });
      },
    };
    registerContract("CSSProcessor", processor);

    const pending = Array.from({ length: 16 }, (_, index) =>
      getCompiler(
        `@import "tailwindcss";/*pending-${index}*/`,
        `pending-project-${index}`,
      ));

    await allStarted;
    invalidateCompiler();
    try {
      await assertRejects(
        () => getCompiler('@import "tailwindcss";/*over-capacity*/', "new-project"),
        Error,
        "Too many concurrent CSS compiler initializations",
      );
    } finally {
      for (const release of releaseCompilers) release();
      await Promise.allSettled(pending);
    }
  });

  it("rejects stylesheet imports outside the supported Tailwind base import", async () => {
    const processor: CSSProcessor = {
      async compile(_stylesheet, options) {
        await options.loadStylesheet("unexpected.css");
        return { build: () => "" };
      },
    };
    registerContract("CSSProcessor", processor);

    await assertRejects(
      () => getCompiler('@import "unexpected.css";/*unsupported-import*/', "test-project"),
      Error,
      "Unsupported stylesheet import",
    );
  });

  it("does not expose project identifiers in compiler cache statistics", async () => {
    const processor: CSSProcessor = {
      compile: () => Promise.resolve({ build: () => "" }),
    };
    registerContract("CSSProcessor", processor);

    await getCompiler('@import "tailwindcss";/*opaque-key*/', "sensitive-project-name");

    assertEquals(
      getCompilerCacheStats().entries.some((entry) =>
        entry.hash.includes("sensitive-project-name")
      ),
      false,
    );
  });
});
