import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import { assembleRenderResult } from "./render-result-assembly.ts";
import type { RenderResult } from "./types.ts";

describe("render-result-assembly", () => {
  it("assembles SSR output, page metadata, and client module payload", () => {
    const nodeMap = new Map<number, unknown>([[1, { tag: "h1" }]]);

    const result = assembleRenderResult({
      slug: "/blog",
      ssrResult: {
        fullHtml: "<!doctype html><html><body>ok</body></html>",
        finalStream: null,
        ssrHash: "ssr-hash",
      },
      pageBundle: {
        compiledCode: "export default function Page() {}",
        frontmatter: { title: "Blog" },
        headings: [{ id: "intro", text: "Intro", level: 2 }],
        nodeMap,
      },
      clientModuleCode: "export default function ClientPage() {}",
      pageModuleType: "mdx",
      shouldCache: false,
    });

    assertEquals(result.html, "<!doctype html><html><body>ok</body></html>");
    assertEquals(result.frontmatter, { title: "Blog" });
    assertEquals(result.headings, [{ id: "intro", text: "Intro", level: 2 }]);
    assertEquals(result.nodeMap, nodeMap);
    assertEquals(result.stream, null);
    assertEquals(result.ssrHash, "ssr-hash");
    assertEquals(result.pageModule, {
      slug: "/blog",
      code: "export default function ClientPage() {}",
      type: "mdx",
    });
  });

  it("persists cacheable results without waiting for persistence", () => {
    let persisted:
      | {
        result: RenderResult;
        slug: string;
        cacheKey: string | undefined;
        nonce: string | undefined;
      }
      | undefined;

    const result = assembleRenderResult({
      slug: "/cached",
      cacheKey: "cache:/cached",
      nonce: "nonce-abc123",
      ssrResult: {
        fullHtml: "<html></html>",
        finalStream: null,
      },
      pageBundle: {
        compiledCode: "",
      },
      shouldCache: true,
      cacheCoordinator: {
        persistResult: async (result, slug, cacheKey, nonce) => {
          persisted = { result, slug, cacheKey, nonce };
        },
      },
    });

    assertExists(persisted);
    assertEquals(persisted.slug, "/cached");
    assertEquals(persisted.cacheKey, "cache:/cached");
    assertEquals(persisted.result, result);
    assertEquals(
      persisted.nonce,
      "nonce-abc123",
      "the per-response nonce must reach the cache coordinator so it can be sealed out of the cached HTML",
    );
  });

  it("logs and swallows a failed background cache persist", async () => {
    const logged: { message: string; metadata?: Record<string, unknown> }[] = [];

    const result = assembleRenderResult({
      slug: "/cached",
      cacheKey: "cache:/cached",
      ssrResult: {
        fullHtml: "<html></html>",
        finalStream: null,
      },
      pageBundle: {
        compiledCode: "",
      },
      shouldCache: true,
      cacheCoordinator: {
        persistResult: () => Promise.reject(new Error("store down")),
      },
      logger: {
        error: (message, metadata) => {
          logged.push({ message, metadata });
        },
      },
    });

    assertEquals(
      result.html,
      "<html></html>",
      "assembly must not await persistence",
    );

    await waitFor(() => logged.length === 1, {
      message: "the failed background persist is reported to the logger",
    });
    assertEquals(
      logged[0]?.message,
      "Cache persist failed",
      "a rejected background persist must be logged, not left unhandled",
    );
    assertEquals(
      logged[0]?.metadata?.slug,
      "/cached",
      "the log record names the slug whose persist failed",
    );
    assertEquals(
      logged[0]?.metadata?.error,
      "store down",
      "the log record carries the underlying failure message",
    );
  });

  it("skips persistence when cache persistence is disabled", () => {
    let persistCalls = 0;

    assembleRenderResult({
      slug: "/skip",
      cacheKey: "cache:/skip",
      ssrResult: {
        fullHtml: "<html></html>",
        finalStream: null,
      },
      pageBundle: {
        compiledCode: "",
      },
      shouldCache: true,
      skipCachePersist: true,
      cacheCoordinator: {
        persistResult: async () => {
          persistCalls++;
        },
      },
    });

    assertEquals(persistCalls, 0);
  });
});
