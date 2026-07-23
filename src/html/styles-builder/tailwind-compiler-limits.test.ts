import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  register as registerContract,
  reset as resetContracts,
} from "#veryfront/extensions/contracts.ts";
import type { CSSProcessor } from "#veryfront/extensions/css/index.ts";
import { generateTailwindCSS, getProjectCSS, invalidateCompiler } from "./tailwind-compiler.ts";
import { invalidateProjectCSS } from "./project-css-cache.ts";

const originalFetch = globalThis.fetch;

describe("styles-builder/tailwind compiler limits", () => {
  let output = ".generated{}";
  let buildCalls = 0;

  beforeEach(() => {
    resetContracts();
    invalidateCompiler();
    output = ".generated{}";
    buildCalls = 0;
    const processor: CSSProcessor = {
      compile: () =>
        Promise.resolve({
          build: () => {
            buildCalls++;
            return output;
          },
        }),
    };
    registerContract("CSSProcessor", processor);
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response("@layer theme, base, components, utilities;", { status: 200 }),
      )) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetContracts();
    invalidateCompiler();
  });

  it("rejects oversized stylesheets before compiling them", async () => {
    const result = await generateTailwindCSS("x".repeat(2 * 1024 * 1024 + 1), []);

    assertEquals(result.error?.includes("Stylesheet exceeds"), true);
    assertEquals(buildCalls, 0);
  });

  it("rejects excessive candidate counts before compiling them", async () => {
    const candidates = Array.from({ length: 50_001 }, (_, index) => `class-${index}`);
    const result = await generateTailwindCSS('@import "tailwindcss";', candidates);

    assertEquals(result.error?.includes("Too many CSS candidates"), true);
    assertEquals(buildCalls, 0);
  });

  it("rejects compiler output that exceeds the response limit", async () => {
    output = "x".repeat(16 * 1024 * 1024 + 1);
    const result = await generateTailwindCSS('@import "tailwindcss";', ["block"]);

    assertEquals(result.error?.includes("Generated CSS exceeds"), true);
    assertEquals(result.css, "");
  });

  it("rejects malformed project slugs before cache access", async () => {
    await assertRejects(
      () => getProjectCSS("../escape", undefined, new Set(["block"])),
      Error,
      "Invalid project slug",
    );
    assertEquals(buildCalls, 0);
  });

  it("does not let a compiler mutate the caller's candidate array", async () => {
    const candidates = ["block"];
    registerContract(
      "CSSProcessor",
      {
        compile: () =>
          Promise.resolve({
            build: (compilerCandidates: string[]) => {
              compilerCandidates.push("injected-by-compiler");
              return ".generated{}";
            },
          }),
      } satisfies CSSProcessor,
    );

    const result = await generateTailwindCSS('@import "tailwindcss";', candidates);

    assertEquals(result.error, undefined);
    assertEquals(candidates, ["block"]);
  });

  it("isolates stateful compilers when a project's candidate set changes", async () => {
    let compileCount = 0;
    registerContract(
      "CSSProcessor",
      {
        compile: () => {
          compileCount++;
          const accumulated = new Set<string>();
          return Promise.resolve({
            build: (compilerCandidates: string[]) => {
              for (const candidate of compilerCandidates) accumulated.add(candidate);
              return [...accumulated].sort().map((candidate) => `.${candidate}{}`).join("");
            },
          });
        },
      } satisfies CSSProcessor,
    );

    const projectSlug = `candidate-scope-${crypto.randomUUID()}`;
    const first = await generateTailwindCSS('@import "tailwindcss";', ["first"], {
      projectSlug,
    });
    const second = await generateTailwindCSS('@import "tailwindcss";', ["second"], {
      projectSlug,
    });

    assertEquals(first.css, ".first{}");
    assertEquals(second.css, ".second{}");
    assertEquals(compileCount, 2);
  });

  it("snapshots project candidates before asynchronous cache access", async () => {
    let observedCandidates: string[] = [];
    registerContract(
      "CSSProcessor",
      {
        compile: () =>
          Promise.resolve({
            build: (compilerCandidates: string[]) => {
              observedCandidates = [...compilerCandidates];
              return ".generated{}";
            },
          }),
      } satisfies CSSProcessor,
    );

    const projectSlug = `candidate-snapshot-${crypto.randomUUID()}`;
    const candidates = new Set(["initial"]);
    const pending = getProjectCSS(projectSlug, '@import "tailwindcss";', candidates);
    candidates.clear();
    candidates.add("mutated");

    try {
      await pending;
      assertEquals(observedCandidates, ["initial"]);
    } finally {
      invalidateProjectCSS(projectSlug);
    }
  });

  it("redacts Windows paths from compilation errors", async () => {
    registerContract(
      "CSSProcessor",
      {
        compile: () => Promise.reject(new Error("C:\\Users\\alice\\project\\secret.css failed")),
      } satisfies CSSProcessor,
    );

    const result = await generateTailwindCSS('@import "tailwindcss";', []);

    assertEquals(result.error?.includes("alice"), false);
    assertEquals(result.error?.includes("C:\\Users"), false);
    assertEquals(result.error?.includes("<path>"), true);
  });
});
