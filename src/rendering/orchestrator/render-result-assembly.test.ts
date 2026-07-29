import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
        stylesheet: {
          kind: "project",
          hash: "project-css-hash",
          css: ".prose { color: rebeccapurple; }",
        },
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
    assertEquals(result.css, ".prose { color: rebeccapurple; }");
    assertEquals(result.pageModule, {
      slug: "/blog",
      code: "export default function ClientPage() {}",
      type: "mdx",
    });
  });

  it("preserves an empty project stylesheet as an explicit CSS payload", () => {
    const result = assembleRenderResult({
      slug: "/empty-stylesheet",
      ssrResult: {
        fullHtml: "<html></html>",
        stylesheet: {
          kind: "project",
          hash: "empty-project-css-hash",
          css: "",
        },
      },
      pageBundle: {
        compiledCode: "",
      },
      shouldCache: false,
    });

    assertEquals(result.css, "");
  });

  it("does not expose a release stylesheet as an inline CSS payload", () => {
    const result = assembleRenderResult({
      slug: "/release-stylesheet",
      ssrResult: {
        fullHtml: "<html></html>",
        stylesheet: {
          kind: "release",
          hash: "release-css-hash",
        },
      },
      pageBundle: {
        compiledCode: "",
      },
      shouldCache: false,
    });

    assertEquals(result.css, undefined);
  });

  it("leaves CSS undefined when SSR produced no stylesheet artifact", () => {
    const result = assembleRenderResult({
      slug: "/no-stylesheet",
      ssrResult: {
        fullHtml: "<html></html>",
      },
      pageBundle: {
        compiledCode: "",
      },
      shouldCache: false,
    });

    assertEquals(result.css, undefined);
  });

  it("persists cacheable results without waiting for persistence", () => {
    let persisted:
      | { result: RenderResult; slug: string; cacheKey: string | undefined }
      | undefined;

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
        persistResult: async (result, slug, cacheKey) => {
          persisted = { result, slug, cacheKey };
        },
      },
    });

    assertExists(persisted);
    assertEquals(persisted.slug, "/cached");
    assertEquals(persisted.cacheKey, "cache:/cached");
    assertEquals(persisted.result, result);
  });

  it("snapshots PageBundle frontmatter at the RenderResult boundary", () => {
    const result = assembleRenderResult({
      slug: "/frontmatter",
      ssrResult: {
        fullHtml: "<html></html>",
        finalStream: null,
      },
      pageBundle: {
        compiledCode: "",
        frontmatter: {
          tags: "release",
          date: new Date("2026-07-24T08:30:00.000Z"),
          nested: { unsafe: true },
        },
      } as unknown as Parameters<typeof assembleRenderResult>[0]["pageBundle"],
      shouldCache: false,
    });

    assertEquals(result.frontmatter, {
      tags: "release",
      date: new Date("2026-07-24T08:30:00.000Z"),
      nested: { unsafe: true },
    });
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
