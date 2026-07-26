import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { mkdir, withTempDir, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { join } from "#veryfront/compat/path";
import { base64urlEncodeBytes } from "#veryfront/utils";
import type { ToolExecutionContext } from "#veryfront/tool/types.ts";
import {
  createSearchKnowledgeTool,
  formatKnowledgeContext,
  normalizeKnowledgeQuery,
  projectKnowledge,
  type ProjectKnowledgeConfig,
  searchProjectKnowledge,
} from "./index.ts";

const originalFetch = globalThis.fetch;

function hostedContext(
  overrides: Partial<ToolExecutionContext> = {},
): ToolExecutionContext {
  return {
    projectId: "project-1",
    projectSlug: "acme",
    authToken: "tenant-token",
    productionMode: true,
    releaseId: "release-1",
    ...overrides,
  };
}

function fileListResponse(
  files: unknown[] = [],
  next: string | null = null,
): Response {
  return new Response(
    JSON.stringify({
      data: files,
      page_info: {
        self: null,
        first: null,
        next,
        prev: null,
      },
      release_id: "release-1",
      release_version: "1",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function hostedFile(path: string, content: string): Record<string, unknown> {
  return {
    id: `file-${path}`,
    version_id: `version-${path}`,
    path,
    content,
    type: "file",
    size: new TextEncoder().encode(content).byteLength,
    updated_at: "2026-07-26T00:00:00.000Z",
  };
}

async function writeKnowledgeDocument(
  projectDir: string,
  name: string,
  content: string,
): Promise<void> {
  const knowledgeDir = join(projectDir, "knowledge");
  await mkdir(knowledgeDir, { recursive: true });
  await writeTextFile(join(knowledgeDir, name), content);
}

function forgedCursor(overrides: Record<string, unknown> = {}): string {
  const payload = {
    version: 1,
    query: "billing",
    offset: 0,
    limit: 1,
    shardCount: 1,
    shardIndex: 0,
    ...overrides,
  };
  return base64urlEncodeBytes(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
}

describe("knowledge lookup boundaries", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("validates public input before hosted I/O", async () => {
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      return Promise.resolve(fileListResponse());
    }) as typeof fetch;

    const error = await assertRejects(() =>
      searchProjectKnowledge(null as never, {}, hostedContext())
    );

    assertInstanceOf(error, Error);
    assertEquals(error.message, "search_knowledge input must be an object");
    assertEquals(fetchCalls, 0);
  });

  it("rejects invalid lookup numbers and project references before traversal", async () => {
    const invalidInputs = [
      { query: "billing", limit: 0 },
      { query: "billing", limit: 1.5 },
      { query: "billing", limit: Number.NaN },
      { query: "billing", shard_count: 0 },
      { query: "billing", shard_count: 1.5 },
      { query: "billing", shard_count: 257 },
      { query: "billing", shard_count: 2, shard_index: -1 },
      { query: "billing", shard_count: 2, shard_index: 0.5 },
      { query: "billing", project_reference: " " },
    ];

    for (const input of invalidInputs) {
      const error = await assertRejects(() => searchProjectKnowledge(input, { projectDir: "." }));
      assertInstanceOf(error, Error);
      assertStringIncludes(error.message, "search_knowledge");
    }
  });

  it("rejects non-canonical and resource-amplifying cursors before hosted I/O", async () => {
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      return Promise.resolve(fileListResponse());
    }) as typeof fetch;

    for (
      const cursor of [
        forgedCursor({ offset: 0.5 }),
        forgedCursor({ offset: -1 }),
        forgedCursor({ limit: 100 }),
        "a".repeat(4_096),
      ]
    ) {
      const error = await assertRejects(() =>
        searchProjectKnowledge(
          { query: "billing", cursor },
          {},
          hostedContext(),
        )
      );
      assertInstanceOf(error, Error);
      assertEquals(error.message, "Invalid knowledge lookup cursor");
    }

    assertEquals(fetchCalls, 0);
  });

  it("trims canonical lookup targets and preserves empty document content", async () => {
    await withTempDir(async (projectDir) => {
      await writeKnowledgeDocument(projectDir, "empty.md", "");

      const result = await projectKnowledge({ projectDir }).lookup({
        lookup_target: " ./knowledge/empty.md ",
      });

      assertEquals(result.returned, 1);
      assertEquals(result.data[0]?.path, "knowledge/empty.md");
      assertEquals(result.data[0]?.content, "");
    });
  });

  it("searches non-Latin paths and frontmatter instead of degrading to browse", async () => {
    await withTempDir(async (projectDir) => {
      await writeKnowledgeDocument(
        projectDir,
        "operations.md",
        [
          "---",
          "title: 東京 運用手順",
          "description: 本番環境の復旧手順",
          "---",
          "",
          "# 東京 運用手順",
        ].join("\n"),
      );
      await writeKnowledgeDocument(
        projectDir,
        "billing.md",
        "---\ntitle: Billing\n---\n\n# Billing",
      );

      const result = await projectKnowledge({ projectDir }).lookup({
        query: "東京",
      });

      assertEquals(result.mode, "search");
      assertEquals(result.returned, 1);
      assertEquals(result.data[0]?.path, "knowledge/operations.md");
      assertEquals(result.data[0]?.matched_fields.includes("title"), true);
    });
  });

  it("uses runtime-independent code-unit ordering for browse ties", async () => {
    await withTempDir(async (projectDir) => {
      await writeKnowledgeDocument(projectDir, "z.md", "---\ntitle: Zed\n---\n");
      await writeKnowledgeDocument(projectDir, "ä.md", "---\ntitle: Umlaut\n---\n");

      const result = await projectKnowledge({ projectDir }).lookup({
        query: "qxv jpk",
      });

      assertEquals(result.mode, "browse");
      assertEquals(
        result.data.map((item) => item.path),
        ["knowledge/z.md", "knowledge/ä.md"],
      );
    });
  });

  it("snapshots project knowledge configuration at construction", async () => {
    await withTempDir(async (rootDir) => {
      const firstProject = join(rootDir, "first");
      const secondProject = join(rootDir, "second");
      await writeKnowledgeDocument(
        firstProject,
        "alpha.md",
        "---\ntitle: Alpha runbook\n---\n",
      );
      await writeKnowledgeDocument(
        secondProject,
        "beta.md",
        "---\ntitle: Beta runbook\n---\n",
      );

      const config: ProjectKnowledgeConfig = { projectDir: firstProject };
      const knowledge = projectKnowledge(config);
      config.projectDir = secondProject;

      const result = await knowledge.lookup({ query: "alpha" });

      assertEquals(result.mode, "search");
      assertEquals(result.data.map((item) => item.path), ["knowledge/alpha.md"]);
    });
  });

  it("rejects unknown or accessor-backed project knowledge configuration", () => {
    assertThrows(
      () => projectKnowledge({ projectDri: "." } as never),
      TypeError,
      "unsupported field",
    );

    let getterCalls = 0;
    const config = {} as ProjectKnowledgeConfig;
    Object.defineProperty(config, "projectDir", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return ".";
      },
    });
    assertThrows(
      () => projectKnowledge(config),
      TypeError,
      "enumerable data properties",
    );
    assertEquals(getterCalls, 0);
  });

  it("validates search_knowledge tool construction options", () => {
    assertThrows(
      () => createSearchKnowledgeTool({ id: "" }),
      TypeError,
      "tool id",
    );
    assertThrows(
      () => createSearchKnowledgeTool({ description: " " }),
      TypeError,
      "description",
    );
    assertThrows(
      () =>
        createSearchKnowledgeTool({
          unknownOption: true,
        } as never),
      TypeError,
      "unsupported field",
    );
  });

  it("fails closed for unreadable or malformed project knowledge", async () => {
    await withTempDir(async (projectDir) => {
      await writeKnowledgeDocument(
        projectDir,
        "broken.md",
        "---\ntitle: [unterminated\n---\nbody",
      );

      const error = await assertRejects(() =>
        projectKnowledge({ projectDir }).lookup({ query: "broken" })
      );

      assertInstanceOf(error, Error);
      assertEquals(
        error.message,
        "Invalid frontmatter in project knowledge document knowledge/broken.md",
      );
      assertEquals(error.cause, undefined);
    });
  });

  it("requires frontmatter to be a bounded mapping", async () => {
    await withTempDir(async (projectDir) => {
      await writeKnowledgeDocument(
        projectDir,
        "scalar.md",
        "---\nnot-a-mapping\n---\nbody",
      );

      const scalarError = await assertRejects(() =>
        projectKnowledge({ projectDir }).lookup({ query: "scalar" })
      );
      assertInstanceOf(scalarError, Error);
      assertStringIncludes(scalarError.message, "Invalid frontmatter");
    });

    await withTempDir(async (projectDir) => {
      const nested = Array.from(
        { length: 18 },
        (_, index) => `${"  ".repeat(index)}level_${index}:`,
      );
      nested.push(`${"  ".repeat(18)}value`);
      await writeKnowledgeDocument(
        projectDir,
        "nested.md",
        `---\n${nested.join("\n")}\n---\nbody`,
      );

      const nestedError = await assertRejects(() =>
        projectKnowledge({ projectDir }).lookup({ query: "nested" })
      );
      assertInstanceOf(nestedError, Error);
      assertStringIncludes(nestedError.message, "structural limits");
    });
  });

  it("bounds individual local knowledge documents", async () => {
    await withTempDir(async (projectDir) => {
      await writeKnowledgeDocument(
        projectDir,
        "oversized.md",
        "x".repeat(1024 * 1024 + 1),
      );

      const error = await assertRejects(() =>
        projectKnowledge({ projectDir }).lookup({
          lookup_target: { path: "knowledge/oversized.md" },
        })
      );

      assertInstanceOf(error, Error);
      assertStringIncludes(error.message, "exceeds");
      assertStringIncludes(error.message, "knowledge/oversized.md");
    });
  });

  it("requires an immutable production content context before hosted I/O", async () => {
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      return Promise.resolve(fileListResponse());
    }) as typeof fetch;

    const error = await assertRejects(() =>
      searchProjectKnowledge(
        { query: "billing" },
        {},
        hostedContext({ releaseId: null, environmentName: null }),
      )
    );

    assertInstanceOf(error, Error);
    assertStringIncludes(error.message, "production knowledge lookup");
    assertEquals(fetchCalls, 0);
  });

  it("uses hosted release content even when a local projectDir is configured", async () => {
    await withTempDir(async (projectDir) => {
      await writeKnowledgeDocument(
        projectDir,
        "local-secret.md",
        "---\ntitle: Local secret\n---\n",
      );
      globalThis.fetch = (() =>
        Promise.resolve(
          fileListResponse([
            hostedFile(
              "knowledge/release.md",
              "---\ntitle: Release runbook\n---\n",
            ),
          ]),
        )) as typeof fetch;

      const result = await searchProjectKnowledge(
        { query: "release" },
        { projectDir },
        hostedContext(),
      );

      assertEquals(result.data.map((item) => item.path), [
        "knowledge/release.md",
      ]);
    });
  });

  it("rejects malformed hosted routing instead of falling back to local files", async () => {
    await withTempDir(async (projectDir) => {
      await writeKnowledgeDocument(
        projectDir,
        "local.md",
        "---\ntitle: Local\n---\n",
      );
      const error = await assertRejects(() =>
        searchProjectKnowledge(
          { query: "local" },
          { projectDir },
          hostedContext({ productionMode: "yes" } as never),
        )
      );

      assertInstanceOf(error, Error);
      assertStringIncludes(error.message, "productionMode");
    });
  });

  it("rejects a hosted project_reference that differs from request scope", async () => {
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      return Promise.resolve(fileListResponse());
    }) as typeof fetch;

    const error = await assertRejects(() =>
      searchProjectKnowledge(
        { query: "billing", project_reference: "another-project" },
        {},
        hostedContext(),
      )
    );

    assertInstanceOf(error, Error);
    assertStringIncludes(error.message, "project_reference");
    assertEquals(fetchCalls, 0);
  });

  it("does not let an explicit empty tool credential inherit request authority", async () => {
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      return Promise.resolve(fileListResponse());
    }) as typeof fetch;

    const error = await assertRejects(() =>
      searchProjectKnowledge(
        { query: "billing" },
        {},
        hostedContext({ authToken: "" }),
      )
    );

    assertInstanceOf(error, Error);
    assertStringIncludes(error.message, "authToken");
    assertEquals(fetchCalls, 0);
  });

  it("uses the centralized Veryfront API base URL", async () => {
    Deno.env.set("VERYFRONT_API_BASE_URL", "https://knowledge-api.test/api/");
    const requestedUrls: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      requestedUrls.push(input instanceof Request ? input.url : String(input));
      return Promise.resolve(fileListResponse());
    }) as typeof fetch;

    await searchProjectKnowledge(
      { query: "billing" },
      {},
      hostedContext(),
    );

    assertEquals(requestedUrls.length, 1);
    assertStringIncludes(requestedUrls[0] ?? "", "https://knowledge-api.test/api/");
  });

  it("honors cancellation before local or hosted lookup work", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      return Promise.resolve(fileListResponse());
    }) as typeof fetch;

    const error = await assertRejects(() =>
      searchProjectKnowledge(
        { query: "billing" },
        {},
        hostedContext({ abortSignal: controller.signal }),
      )
    );

    assertInstanceOf(error, DOMException);
    assertEquals(error.name, "AbortError");
    assertEquals(fetchCalls, 0);
  });

  it("cancels an in-flight hosted manifest request without retrying", async () => {
    const controller = new AbortController();
    let fetchCalls = 0;
    let requestStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls += 1;
      const signal = init?.signal;
      requestStarted?.();
      return new Promise<Response>((_resolve, reject) => {
        if (!signal) {
          reject(new Error("request did not receive an AbortSignal"));
          return;
        }
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    }) as typeof fetch;

    const pending = searchProjectKnowledge(
      { query: "billing" },
      {},
      hostedContext({ abortSignal: controller.signal }),
    );
    await started;
    controller.abort(new DOMException("cancelled", "AbortError"));

    const error = await assertRejects(() => pending);
    assertInstanceOf(error, DOMException);
    assertEquals(error.name, "AbortError");
    assertEquals(fetchCalls, 1);
  });

  it("forwards RAG cancellation through search and retrieve", async () => {
    await withTempDir(async (projectDir) => {
      const knowledge = projectKnowledge({ projectDir });
      const controller = new AbortController();
      controller.abort(new DOMException("cancelled", "AbortError"));

      for (
        const operation of [
          () => knowledge.search("billing", { abortSignal: controller.signal }),
          () => knowledge.retrieve("billing", { abortSignal: controller.signal }),
        ]
      ) {
        const error = await assertRejects(operation);
        assertInstanceOf(error, DOMException);
        assertEquals(error.name, "AbortError");
      }
    });
  });

  it("validates per-call RAG options before reading the store", async () => {
    await withTempDir(async (projectDir) => {
      const knowledge = projectKnowledge({ projectDir });
      for (
        const operation of [
          () => knowledge.search("billing", { topK: 101 }),
          () => knowledge.retrieve("billing", { topK: 101 }),
        ]
      ) {
        const error = await assertRejects(operation);
        assertInstanceOf(error, RangeError);
        assertStringIncludes(error.message, "100");
      }

      let getterCalls = 0;
      const options = {};
      Object.defineProperty(options, "topK", {
        enumerable: true,
        get() {
          getterCalls += 1;
          return 3;
        },
      });
      const accessorError = await assertRejects(() =>
        knowledge.search("billing", options as never)
      );
      assertInstanceOf(accessorError, TypeError);
      assertEquals(getterCalls, 0);
    });
  });

  it("bounds normalized queries and prompt-ready context", () => {
    assertEquals(
      normalizeKnowledgeQuery(`${"x".repeat(499)}😀`, 500),
      "x".repeat(499),
    );
    assertThrows(
      () => normalizeKnowledgeQuery("x".repeat(64 * 1024 + 1)),
      RangeError,
      "input code units",
    );
    assertThrows(
      () =>
        formatKnowledgeContext(
          Array.from({ length: 101 }, (_, index) => ({
            documentId: `doc-${index}`,
            title: "Title",
            source: "knowledge/source.md",
            type: "md",
            score: 1,
            text: "text",
          })),
        ),
      RangeError,
      "at most 100",
    );
    assertThrows(
      () =>
        formatKnowledgeContext([{
          documentId: "doc",
          title: "Title",
          source: "knowledge/source.md",
          type: "md",
          score: 1,
          text: "😀".repeat(300_000),
        }]),
      RangeError,
      "UTF-8 bytes",
    );
    assertThrows(
      () =>
        formatKnowledgeContext([{
          documentId: "doc",
          title: "Title",
          source: "knowledge/source.md",
          type: "md",
          score: Number.NaN,
          text: "text",
        }]),
      TypeError,
      "malformed",
    );
  });

  it("rejects repeated hosted pagination cursors instead of looping", async () => {
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      return Promise.resolve(
        fileListResponse([], fetchCalls < 3 ? "repeated-cursor" : null),
      );
    }) as typeof fetch;

    const error = await assertRejects(() =>
      searchProjectKnowledge(
        { query: "billing" },
        {},
        hostedContext(),
      )
    );

    assertInstanceOf(error, Error);
    assertStringIncludes(error.message, "repeated pagination cursor");
    assertEquals(fetchCalls, 2);
  });

  it("validates each hosted page before requesting the next page", async () => {
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      return Promise.resolve(
        fileListResponse(
          [
            hostedFile(
              "knowledge/oversized.md",
              "x".repeat(1024 * 1024 + 1),
            ),
          ],
          "next-page",
        ),
      );
    }) as typeof fetch;

    const error = await assertRejects(() =>
      searchProjectKnowledge(
        { query: "oversized" },
        {},
        hostedContext(),
      )
    );

    assertInstanceOf(error, Error);
    assertStringIncludes(error.message, "exceeds");
    assertEquals(fetchCalls, 1);
  });

  it("rejects an empty upstream pagination cursor", async () => {
    globalThis.fetch = (() => Promise.resolve(fileListResponse([], ""))) as typeof fetch;

    const error = await assertRejects(() =>
      searchProjectKnowledge(
        { query: "billing" },
        {},
        hostedContext(),
      )
    );

    assertInstanceOf(error, Error);
    assertStringIncludes(error.message, "invalid pagination cursor");
  });

  it("rejects lookup queries that would be silently truncated", async () => {
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      return Promise.resolve(fileListResponse());
    }) as typeof fetch;

    const error = await assertRejects(() =>
      searchProjectKnowledge(
        { query: "q".repeat(501) },
        {},
        hostedContext(),
      )
    );

    assertInstanceOf(error, Error);
    assertStringIncludes(error.message, "500");
    assertEquals(fetchCalls, 0);
  });
});
