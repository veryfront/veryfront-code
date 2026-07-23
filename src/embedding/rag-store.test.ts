import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { exists, readTextFile, withTempDir } from "#veryfront/testing/deno-compat.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { join, relative } from "#veryfront/compat/path";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { ragStore } from "./rag-store.ts";
import { clearEmbeddingProviders, registerEmbeddingProvider } from "./resolve.ts";

const CLOUD_ENV_KEYS = [
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
  "VERYFRONT_RAG_BACKEND",
  "VERYFRONT_SERVICE_LAYER",
] as const;

function clearCloudEnv(): void {
  for (const key of CLOUD_ENV_KEYS) {
    try {
      deleteEnv(key);
    } catch {
      // expected: env may already be unset
    }
  }
}

function registerTestEmbeddingProvider(): void {
  registerEmbeddingProvider("test", () =>
    ({
      specificationVersion: "v2",
      provider: "test",
      modelId: "test/demo",
      maxEmbeddingsPerCall: undefined,
      supportsParallelCalls: true,
      async doEmbed({ values }: { values: string[] }) {
        return {
          embeddings: values.map((value, index) => {
            const vector = new Array<number>(1536).fill(index);
            vector[0] = value.length;
            return vector;
          }),
          usage: { tokens: 0 },
          rawResponse: undefined,
          warnings: [],
        };
      },
    }) as never);
}

describe("ragStore", () => {
  afterEach(() => {
    clearCloudEnv();
    clearEmbeddingProviders();
  });

  it("returns empty uploads when storage file does not exist", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const store = ragStore({
        model: "local/test-model",
        storagePath,
      });

      const documents = await store.listDocuments();
      assertEquals(documents, []);
    });
  });

  it("does not expose local storage paths when persisted data cannot be read", async () => {
    await withTempDir(async (tempDir) => {
      const store = ragStore({
        model: "local/test-model",
        storagePath: tempDir,
      });

      const error = await assertRejects(() => store.listDocuments());
      assertInstanceOf(error, Error);
      assertEquals(error.message, "Local RAG store data could not be read");
      assertEquals(error.message.includes(tempDir), false);
      assertEquals(error.cause, undefined);
    });
  });

  it("does not expose local content paths when directory traversal fails", async () => {
    await withTempDir(async (tempDir) => {
      const contentPath = join(tempDir, "knowledge.md");
      await Deno.writeTextFile(contentPath, "# Not a directory");
      const store = ragStore({
        model: "local/test-model",
        storagePath: join(tempDir, "data", "index.json"),
        contentDir: contentPath,
      });

      const error = await assertRejects(() => store.indexContentDir());
      assertInstanceOf(error, Error);
      assertEquals(error.message, "RAG content files could not be read");
      assertEquals(error.message.includes(tempDir), false);
      assertEquals(error.cause, undefined);
    });
  });

  it("persists ingest with atomic temp+rename workflow", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const store = ragStore({
        model: "local/test-model",
        storagePath,
      });

      const id = await store.ingest("Doc", "Hello world", {
        source: "upload:test.txt",
        type: "txt",
      });
      assert(id.length > 0);

      const documents = await store.listDocuments();
      assertEquals(documents.length, 1);
      assertEquals(documents[0]?.id, id);

      const persisted = await readTextFile(storagePath);
      const parsed = JSON.parse(persisted) as {
        documents: unknown[];
        chunks: unknown[];
      };
      assertEquals(Array.isArray(parsed.documents), true);
      assertEquals(Array.isArray(parsed.chunks), true);
      assertEquals(persisted, JSON.stringify(parsed));
      assertEquals(await exists(storagePath + ".tmp"), false);
    });
  });

  it("refreshes an existing local document while preserving its id", async () => {
    registerTestEmbeddingProvider();

    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const store = ragStore({
        model: "test/demo",
        storagePath,
      });
      const id = await store.ingest("Deck", "Old slide text", {
        source: "upload:deck.pptx",
        type: "pptx",
      });

      await store.search("old");
      const embedded = JSON.parse(await readTextFile(storagePath)) as {
        chunks: Array<{ embedding: number[] }>;
      };
      assertEquals(embedded.chunks[0]?.embedding.length, 1536);

      const refresh = store.refreshDocument;
      assert(refresh);
      await refresh(id, "# New Slide Title\n\nNew body text", {
        title: "Deck Updated",
        source: "upload:deck-updated.pptx",
        type: "pptx",
      });

      const refreshed = JSON.parse(await readTextFile(storagePath)) as {
        documents: Array<
          { id: string; title: string; source: string; type: string; createdAt: number }
        >;
        chunks: Array<{ documentId: string; text: string; embedding: number[]; index: number }>;
      };
      assertEquals(refreshed.documents.length, 1);
      assertEquals(refreshed.documents[0]?.id, id);
      assertEquals(refreshed.documents[0]?.title, "Deck Updated");
      assertEquals(refreshed.documents[0]?.source, "upload:deck-updated.pptx");
      assertEquals(refreshed.documents[0]?.type, "pptx");
      assertEquals(typeof refreshed.documents[0]?.createdAt, "number");
      assertEquals(refreshed.chunks.length, 1);
      assertEquals(refreshed.chunks[0]?.documentId, id);
      assertEquals(refreshed.chunks[0]?.text, "# New Slide Title\n\nNew body text");
      assertEquals(refreshed.chunks[0]?.embedding, []);
      assertEquals(refreshed.chunks[0]?.index, 0);
    });
  });

  it("returns empty results for whitespace-only local queries", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const store = ragStore({
        model: "local/test-model",
        storagePath,
      });

      await store.ingest("Doc", "Hello world", {
        source: "upload:test.txt",
        type: "txt",
      });

      const results = await store.search("   ");
      assertEquals(results, []);
    });
  });

  it("uses the same non-negative default score threshold as the cloud backend", async () => {
    registerEmbeddingProvider("test", () =>
      ({
        specificationVersion: "v2",
        provider: "test",
        modelId: "test/demo",
        maxEmbeddingsPerCall: undefined,
        supportsParallelCalls: true,
        async doEmbed({ values }: { values: string[] }) {
          return {
            embeddings: values.map((value) => value === "negative" ? [-1, 0] : [1, 0]),
            usage: { tokens: 0 },
            rawResponse: undefined,
            warnings: [],
          };
        },
      }) as never);

    await withTempDir(async (tempDir) => {
      const store = ragStore({
        model: "test/demo",
        storagePath: join(tempDir, "index.json"),
      });
      await store.ingest("Positive", "positive");
      await store.ingest("Negative", "negative");

      const results = await store.search("query", { topK: 2 });

      assertEquals(results.map((result) => result.title), ["Positive"]);
    });
  });

  it("stops local search before embedding when cancellation is requested", async () => {
    let providerCalls = 0;
    registerEmbeddingProvider("cancel", () =>
      ({
        async doEmbed({ values }: { values: string[] }) {
          providerCalls++;
          return { embeddings: values.map(() => [1, 0]) };
        },
      }) as never);

    await withTempDir(async (tempDir) => {
      const store = ragStore({
        model: "cancel/test",
        storagePath: join(tempDir, "data", "index.json"),
      });
      await store.ingest("Doc", "Hello world");
      const controller = new AbortController();
      controller.abort();

      await assertRejects(
        () => store.search("hello", { signal: controller.signal }),
        DOMException,
        "aborted",
      );
      assertEquals(providerCalls, 0);
    });
  });

  it("uses one request-scoped embedder for each local search", async () => {
    let factoryCalls = 0;
    registerEmbeddingProvider("test", () => {
      factoryCalls++;
      return {
        specificationVersion: "v2",
        provider: "test",
        modelId: "test/demo",
        maxEmbeddingsPerCall: undefined,
        supportsParallelCalls: true,
        async doEmbed({ values }: { values: string[] }) {
          return {
            embeddings: values.map(() => [1, 0]),
            usage: { tokens: 0 },
            rawResponse: undefined,
            warnings: [],
          };
        },
      } as never;
    });

    await withTempDir(async (tempDir) => {
      const store = ragStore({
        model: "test/demo",
        storagePath: join(tempDir, "index.json"),
      });
      await store.ingest("Doc", "Document text");

      await store.search("query");

      assertEquals(factoryCalls, 1);
    });
  });

  it("batches lazy embeddings across accumulated local documents", async () => {
    const providerBatchSizes: number[] = [];
    registerEmbeddingProvider("test", () =>
      ({
        specificationVersion: "v2",
        provider: "test",
        modelId: "test/demo",
        maxEmbeddingsPerCall: undefined,
        supportsParallelCalls: true,
        async doEmbed({ values }: { values: string[] }) {
          providerBatchSizes.push(values.length);
          return {
            embeddings: values.map(() => [1, 0]),
            usage: { tokens: 0 },
            rawResponse: undefined,
            warnings: [],
          };
        },
      }) as never);

    await withTempDir(async (tempDir) => {
      const store = ragStore({
        model: "test/demo",
        storagePath: join(tempDir, "index.json"),
        chunkOptions: { maxChars: 1, overlap: 0, separators: [""] },
        batchSize: 10_000,
      });
      await store.ingest("First", "a".repeat(6_000));
      await store.ingest("Second", "b".repeat(6_000));

      const results = await store.search("query", { topK: 1 });

      assertEquals(results.length, 1);
      assertEquals(providerBatchSizes, [10_000, 2_000, 1]);
    });
  });

  it("rejects empty documents and invalid search options before embedding", async () => {
    registerTestEmbeddingProvider();

    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const store = ragStore({ model: "test/demo", storagePath });

      await assertRejects(
        () => store.ingest("Empty", "   "),
        Error,
        "RAG document text must not be empty",
      );
      await store.ingest("Doc", "Hello world");
      await assertRejects(
        () => store.search("hello", { topK: 0 }),
        Error,
        "topK must be a positive integer",
      );
      await assertRejects(
        () => store.search("hello", { threshold: Number.NaN }),
        Error,
        "threshold must be a finite number",
      );
      await assertRejects(
        () => store.search("hello", null as never),
        Error,
        "RAG search options must be an object",
      );
    });
  });

  it("rejects invalid backends when the store is created", () => {
    assertThrows(
      () => ragStore({ backend: "memory" as never }),
      Error,
      "Invalid RAG backend",
    );
  });

  it("rejects content extensions that cannot match one file extension", () => {
    for (const extension of [".md ", "../md", ".tar.gz"]) {
      assertThrows(
        () =>
          ragStore({
            model: "local/test-model",
            contentExtensions: [extension],
          }),
        Error,
        "content extensions must be single file extensions",
      );
    }
  });

  it("snapshots mutable configuration at construction", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "original", "index.json");
      const changedPath = join(tempDir, "changed", "index.json");
      const config = {
        model: "local/test-model",
        storagePath,
        contentExtensions: [".md"],
        chunkOptions: { maxChars: 100, overlap: 10 },
      };
      const store = ragStore(config);

      config.storagePath = changedPath;
      config.contentExtensions.push(".txt");
      config.chunkOptions.maxChars = 1;
      await store.ingest("Doc", "Hello world");

      assertEquals(await exists(storagePath), true);
      assertEquals(await exists(changedPath), false);
      const persisted = JSON.parse(await readTextFile(storagePath)) as { chunks: unknown[] };
      assertEquals(persisted.chunks.length, 1);
    });
  });

  it("re-embeds local chunks when the configured model changes", async () => {
    const calls: string[][] = [];
    registerEmbeddingProvider("first", () =>
      ({
        async doEmbed({ values }: { values: string[] }) {
          return { embeddings: values.map(() => [1, 0]) };
        },
      }) as never);

    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const first = ragStore({ model: "first/model", storagePath });
      await first.ingest("Doc", "Hello world");
      await first.search("hello");

      registerEmbeddingProvider("second", () =>
        ({
          async doEmbed({ values }: { values: string[] }) {
            calls.push([...values]);
            return { embeddings: values.map(() => [0, 1, 0]) };
          },
        }) as never);
      const second = ragStore({ model: "second/model", storagePath });

      const results = await second.search("hello");
      assertEquals(results.length, 1);
      assertEquals(calls.some((values) => values.includes("Hello world")), true);
      const persisted = JSON.parse(await readTextFile(storagePath)) as {
        embeddingModel?: string;
      };
      assertEquals(persisted.embeddingModel, "second/model");
    });
  });

  it("re-embeds local chunks when the document prefix changes", async () => {
    const calls: string[][] = [];
    registerEmbeddingProvider("prefix", () =>
      ({
        async doEmbed({ values }: { values: string[] }) {
          calls.push([...values]);
          return { embeddings: values.map(() => [1, 0]) };
        },
      }) as never);

    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const first = ragStore({
        model: "prefix/model",
        documentPrefix: "old: ",
        storagePath,
      });
      await first.ingest("Doc", "Hello world");
      await first.search("hello");

      calls.length = 0;
      const second = ragStore({
        model: "prefix/model",
        documentPrefix: "new: ",
        storagePath,
      });
      await second.search("hello");

      assertEquals(calls.some((values) => values.includes("new: Hello world")), true);
    });
  });

  it("serializes local stores that share one storage path", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const first = ragStore({ model: "local/test-model", storagePath });
      const second = ragStore({ model: "local/test-model", storagePath });

      await Promise.all([
        first.ingest("First", "First content"),
        second.ingest("Second", "Second content"),
      ]);

      const documents = await ragStore({ model: "local/test-model", storagePath })
        .listDocuments();
      assertEquals(documents.map((document) => document.title).sort(), ["First", "Second"]);
    });
  });

  it("persists content sources without local absolute paths", async () => {
    await withTempDir(async (tempDir) => {
      const contentDir = join(tempDir, "knowledge");
      const storagePath = join(tempDir, "data", "index.json");
      await Deno.mkdir(contentDir, { recursive: true });
      await Deno.writeTextFile(join(contentDir, "login.md"), "Login help");

      const store = ragStore({
        model: "local/test-model",
        contentDir,
        storagePath,
      });
      await store.indexContentDir();

      const documents = await store.listDocuments();
      assertEquals(documents[0]?.source, "knowledge/login.md");
      assertEquals(documents[0]?.source.includes(tempDir), false);
    });
  });

  it("normalizes sources when contentDir is a multi-segment relative path", async () => {
    await withTempDir(async (tempDir) => {
      const contentDir = join(tempDir, "projects", "acme", "knowledge");
      const storagePath = join(tempDir, "data", "index.json");
      await Deno.mkdir(contentDir, { recursive: true });
      await Deno.writeTextFile(join(contentDir, "login.md"), "Login help");

      const store = ragStore({
        model: "local/test-model",
        contentDir: relative(Deno.cwd(), contentDir),
        storagePath,
      });
      await store.indexContentDir();

      const documents = await store.listDocuments();
      assertEquals(documents[0]?.source, "knowledge/login.md");
    });
  });

  it("does not send local absolute content paths to the cloud RAG backend", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_cloud");
    setEnv("VERYFRONT_PROJECT_SLUG", "cloud-project");
    registerTestEmbeddingProvider();

    await withTempDir(async (tempDir) => {
      const contentDir = join(tempDir, "knowledge");
      await Deno.mkdir(contentDir, { recursive: true });
      await Deno.writeTextFile(join(contentDir, "login.md"), "Login help");
      let persistedSource = "";

      await withMockFetch(
        async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const url = new URL(request.url);
          if (request.method === "GET" && url.pathname.endsWith("/rag/documents")) {
            return Response.json({ documents: [] });
          }
          if (
            request.method === "POST" && url.pathname.includes("/files/") &&
            url.pathname.endsWith("/chunks")
          ) {
            const body = await request.json() as {
              chunks: Array<{ chunk_index: number }>;
            };
            return Response.json({
              chunks: body.chunks.map(({ chunk_index }) => ({
                id: `chunk-${chunk_index}`,
                index: chunk_index,
              })),
            });
          }
          if (request.method === "POST" && url.pathname.endsWith("/embeddings")) {
            return Response.json({ created: 1 });
          }
          if (request.method === "POST" && url.pathname.endsWith("/rag/documents")) {
            const body = await request.json() as { source: string };
            persistedSource = body.source;
            return Response.json({ created: 1 });
          }
          throw new Error(`Unhandled ${request.method} ${url.pathname}`);
        },
        async () => {
          const store = ragStore({ model: "test/demo", contentDir });
          await runWithRequestContext(
            {
              projectSlug: "cloud-project",
              token: "request-scoped-token",
              productionMode: false,
              branch: "main",
            },
            () => store.indexContentDir(),
          );
        },
      );

      assertEquals(persistedSource, "knowledge/login.md");
      assertEquals(persistedSource.includes(tempDir), false);
    });
  });

  it("reuses parsed local store data across searches until storage changes", async () => {
    registerTestEmbeddingProvider();

    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const store = ragStore({
        model: "test/demo",
        storagePath,
      });

      await store.ingest("Doc", "Hello world", {
        source: "upload:test.txt",
        type: "txt",
      });

      let parseCalls = 0;
      const originalParse = JSON.parse;
      JSON.parse = ((text, reviver) => {
        parseCalls++;
        return originalParse(text, reviver);
      }) as typeof JSON.parse;

      try {
        await store.search("hello");
        await store.search("hello");

        assertEquals(
          parseCalls <= 1,
          true,
          `Expected repeated searches to parse the store at most once, got ${parseCalls}`,
        );

        parseCalls = 0;
        const previousInfo = await Deno.stat(storagePath);
        const previousPayload = await readTextFile(storagePath);
        const externalPayload = previousPayload.replace('"title":"Doc"', '"title":"Alt"');
        assertEquals(externalPayload.length, previousPayload.length);
        await new Promise((resolve) => setTimeout(resolve, 5));
        await Deno.writeTextFile(storagePath, externalPayload);
        if (previousInfo.mtime !== null) {
          await Deno.utime(
            storagePath,
            previousInfo.atime ?? previousInfo.mtime,
            previousInfo.mtime,
          );
        }

        const documents = await store.listDocuments();
        assertEquals(documents.map((document) => document.title), ["Alt"]);
        assertEquals(parseCalls, 1);
      } finally {
        JSON.parse = originalParse;
      }
    });
  });

  it("migrates legacy upload-store data from data/index.json", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      await Deno.mkdir(join(tempDir, "data"), { recursive: true });
      await Deno.writeTextFile(
        storagePath,
        JSON.stringify({
          uploads: [{
            id: "upload-1",
            title: "Legacy Doc",
            source: "upload:legacy.txt",
            type: "txt",
            createdAt: 1,
          }],
          chunks: [{
            id: "chunk-1",
            uploadId: "upload-1",
            text: "legacy content",
            embedding: [],
            index: 0,
          }],
        }),
      );

      const store = ragStore({
        model: "local/test-model",
        storagePath,
      });

      const documents = await store.listDocuments();
      assertEquals(documents, [{
        id: "upload-1",
        title: "Legacy Doc",
        source: "upload:legacy.txt",
        type: "txt",
        createdAt: 1,
      }]);
    });
  });

  it("fails closed when local document entries are invalid", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      await Deno.mkdir(join(tempDir, "data"), { recursive: true });
      await Deno.writeTextFile(
        storagePath,
        JSON.stringify({
          documents: [{
            id: 123,
            title: "Invalid Doc",
            source: "upload:invalid.txt",
            type: "txt",
            createdAt: 1,
          }],
          chunks: [],
        }),
      );

      const store = ragStore({
        model: "local/test-model",
        storagePath,
      });

      await assertRejects(
        () => store.listDocuments(),
        Error,
        "RAG store data is invalid",
      );
      assertEquals((await readTextFile(storagePath)).includes("Invalid Doc"), true);
    });
  });

  it("fails closed when local chunk entries are invalid", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      await Deno.mkdir(join(tempDir, "data"), { recursive: true });
      await Deno.writeTextFile(
        storagePath,
        JSON.stringify({
          documents: [{
            id: "doc-1",
            title: "Valid Doc",
            source: "upload:valid.txt",
            type: "txt",
            createdAt: 1,
          }],
          chunks: [{
            id: "chunk-1",
            documentId: "doc-1",
            text: "content",
            embedding: ["not-a-number"],
            index: 0,
          }],
        }),
      );

      const store = ragStore({
        model: "local/test-model",
        storagePath,
      });

      await assertRejects(
        () => store.listDocuments(),
        Error,
        "RAG store data is invalid",
      );
      assertEquals((await readTextFile(storagePath)).includes("not-a-number"), true);
    });
  });

  it("auto-upgrades to the veryfront-cloud backend when cloud bootstrap is present", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_cloud");
    setEnv("VERYFRONT_PROJECT_SLUG", "cloud-project");
    registerTestEmbeddingProvider();

    const fileChunks = new Map<
      string,
      Array<{
        id: string;
        index: number;
        content: string;
        metadata?: Record<string, unknown>;
      }>
    >();
    const ragDocuments = new Map<string, {
      id: string;
      title: string;
      source: string;
      type: string;
      created_at: string;
      updated_at: string;
      metadata?: Record<string, unknown>;
    }>();
    const embeddingVectors = new Map<string, number[]>();
    const authHeaders: Array<string | null> = [];
    const postContentTypes: Array<string | null> = [];

    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        const path = url.pathname;
        authHeaders.push(request.headers.get("authorization"));
        if (request.method === "POST") {
          postContentTypes.push(request.headers.get("content-type"));
        }

        const fileMatch = path.match(/^\/projects\/[^/]+\/branches\/[^/]+\/files\/(.+)\/chunks$/);
        const filePath = fileMatch ? decodeURIComponent(fileMatch[1]!) : null;

        // RAG document management routes
        const ragDocMatch = path.match(/^\/projects\/[^/]+\/rag\/documents(?:\/(.+))?$/);
        if (ragDocMatch !== null) {
          const docId = ragDocMatch[1] ? decodeURIComponent(ragDocMatch[1]) : null;

          if (request.method === "GET" && !docId) {
            return Response.json({
              documents: [...ragDocuments.values()],
            });
          }

          if (request.method === "POST" && !docId) {
            const body = await request.json() as {
              id: string;
              title: string;
              source: string;
              type: string;
              metadata?: Record<string, unknown>;
            };
            ragDocuments.set(body.id, {
              ...body,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
            return Response.json({ id: body.id });
          }

          if (request.method === "DELETE" && docId) {
            ragDocuments.delete(docId);
            return Response.json({ deleted: 1 });
          }
        }

        if (request.method === "GET" && filePath) {
          const chunks = fileChunks.get(filePath);
          if (!chunks) {
            return new Response("Not found", { status: 404 });
          }
          return Response.json({
            data: chunks,
            page_info: { next: null },
          });
        }

        if (request.method === "DELETE" && filePath) {
          fileChunks.delete(filePath);
          return Response.json({ deleted: 1 });
        }

        if (request.method === "POST" && filePath) {
          const body = await request.json() as {
            chunks: Array<{
              chunk_index: number;
              content: string;
              metadata?: Record<string, unknown>;
            }>;
          };
          const stored = body.chunks.map((chunk) => ({
            id: `${filePath}:${chunk.chunk_index}`,
            index: chunk.chunk_index,
            content: chunk.content,
            metadata: chunk.metadata,
          }));
          fileChunks.set(filePath, stored);

          return Response.json({
            chunks: stored.map(({ id, index }) => ({ id, index })),
            created: stored.length,
            updated: 0,
          });
        }

        if (request.method === "POST" && path.endsWith("/embeddings")) {
          const body = await request.json() as {
            chunk_ids: string[];
            vectors: number[][];
          };
          body.chunk_ids.forEach((chunkId, index) => {
            embeddingVectors.set(chunkId, body.vectors[index]!);
          });

          return Response.json({
            embeddings: body.chunk_ids.map((chunkId) => ({
              id: `embedding:${chunkId}`,
              model: "test/demo",
              status: "ready",
              created_at: new Date().toISOString(),
            })),
            created: body.chunk_ids.length,
            updated: 0,
          });
        }

        if (request.method === "POST" && path.endsWith("/search")) {
          const body = await request.json() as { limit: number };
          const manifestChunks = fileChunks.get(".veryfront/rag/manifest.json") ?? [];
          const documentFilePath = [...fileChunks.keys()].find((key) =>
            key.startsWith(".veryfront/rag/documents/")
          );
          const documentChunks = documentFilePath ? (fileChunks.get(documentFilePath) ?? []) : [];

          return Response.json({
            data: [
              ...Array.from({ length: 30 }, (_, index) => ({
                chunk: {
                  file_path: `src/private-${index}.ts`,
                  content: "Non-RAG project content",
                  metadata: { kind: "source-file" },
                },
                score: 1,
              })),
              ...manifestChunks.map((chunk) => ({
                chunk: {
                  file_path: ".veryfront/rag/manifest.json",
                  content: chunk.content,
                  metadata: chunk.metadata,
                },
                score: 0.99,
              })),
              ...documentChunks.map((chunk) => ({
                chunk: {
                  file_path: documentFilePath,
                  content: chunk.content,
                  metadata: chunk.metadata,
                },
                score: 0.91,
              })),
            ].slice(0, body.limit),
          });
        }

        return new Response(`Unhandled ${request.method} ${path}`, { status: 404 });
      },
      async () => {
        const store = ragStore({
          model: "test/demo",
        });

        const id = await store.ingest("Cloud Doc", "Hello cloud world", {
          source: "upload:cloud.txt",
          type: "txt",
        });

        const documents = await store.listDocuments();
        assertEquals(documents.length, 1);
        assertEquals(documents[0]?.id, id);

        const results = await store.search("cloud", { topK: 1 });
        assertEquals(results.length, 1);
        assertEquals(results[0]?.documentId, id);
        assertEquals(results[0]?.title, "Cloud Doc");

        assertEquals(embeddingVectors.size > 0, true);
        assertEquals(authHeaders.some((header) => header === "Bearer vf_test_cloud"), true);
        assertEquals(
          postContentTypes.every((contentType) => contentType === "application/json"),
          true,
        );

        await store.removeDocument(id);
        assertEquals(await store.listDocuments(), []);
      },
    );
  });

  it("validates cloud document responses before exposing them", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_cloud");
    setEnv("VERYFRONT_PROJECT_SLUG", "cloud-project");

    await withMockFetch(
      async () => Response.json({ documents: [{ id: 123 }] }),
      async () => {
        const store = ragStore({ model: "test/demo" });
        await assertRejects(
          () => store.listDocuments(),
          Error,
          "Veryfront Cloud returned an invalid RAG document response",
        );
      },
    );

    const duplicate = {
      id: "duplicate",
      title: "Duplicate",
      source: "upload:duplicate.txt",
      type: "txt",
      metadata: {},
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    await withMockFetch(
      async () => Response.json({ documents: [duplicate, duplicate] }),
      async () => {
        const store = ragStore({ model: "test/demo" });
        await assertRejects(
          () => store.listDocuments(),
          Error,
          "Veryfront Cloud returned duplicate RAG document IDs",
        );
      },
    );
  });

  it("cleans cloud chunks when document persistence fails without exposing the response body", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_cloud");
    setEnv("VERYFRONT_PROJECT_SLUG", "cloud-project");
    registerTestEmbeddingProvider();
    const deletedPaths: string[] = [];

    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const path = new URL(request.url).pathname;
        const fileMatch = path.match(
          /^\/projects\/[^/]+\/branches\/[^/]+\/files\/(.+)\/chunks$/,
        );
        const filePath = fileMatch ? decodeURIComponent(fileMatch[1]!) : null;

        if (request.method === "POST" && filePath) {
          const body = await request.json() as {
            chunks: Array<{ chunk_index: number }>;
          };
          return Response.json({
            chunks: body.chunks.map((entry) => ({
              id: `${filePath}:${entry.chunk_index}`,
              index: entry.chunk_index,
            })),
          });
        }
        if (request.method === "DELETE" && filePath) {
          deletedPaths.push(filePath);
          return Response.json({ deleted: 1 });
        }
        if (request.method === "POST" && path.endsWith("/embeddings")) {
          return Response.json({ created: 1 });
        }
        if (request.method === "POST" && path.endsWith("/rag/documents")) {
          return new Response("private upstream detail <TOKEN>", { status: 500 });
        }
        throw new Error(`Unhandled ${request.method} ${path}`);
      },
      async () => {
        const store = ragStore({ model: "test/demo" });
        const error = await assertRejects(
          () => store.ingest("Cloud Doc", "Hello cloud world"),
          Error,
          "Veryfront Cloud RAG request failed with status 500",
        );

        assertEquals(error.message.includes("<TOKEN>"), false);
        assertEquals(deletedPaths.length, 1);
      },
    );
  });

  it("stops cloud content pagination when a cursor repeats", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_cloud");
    setEnv("VERYFRONT_PROJECT_SLUG", "cloud-project");
    let fileListCalls = 0;

    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        if (request.method === "GET" && url.pathname.endsWith("/rag/documents")) {
          return Response.json({ documents: [] });
        }
        if (request.method === "GET" && url.pathname.endsWith("/files")) {
          fileListCalls++;
          if (fileListCalls > 2) {
            return new Response("pagination did not stop", { status: 500 });
          }
          return Response.json({ data: [], page_info: { next: "same-cursor" } });
        }
        throw new Error(`Unhandled ${request.method} ${url.pathname}`);
      },
      async () => {
        const store = ragStore({ model: "test/demo", contentDir: "knowledge" });
        await assertRejects(
          () =>
            runWithRequestContext(
              { projectSlug: "cloud-project", token: "vf_request_token" },
              () => store.indexContentDir(),
            ),
          Error,
          "Veryfront Cloud pagination cursor repeated",
        );
        assertEquals(fileListCalls, 2);
      },
    );
  });

  it("rejects published file details that do not match the requested path", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_cloud");
    setEnv("VERYFRONT_PROJECT_SLUG", "cloud-project");

    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        if (request.method === "GET" && url.pathname.endsWith("/rag/documents")) {
          return Response.json({ documents: [] });
        }
        if (request.method === "GET" && url.pathname.endsWith("/files")) {
          return Response.json({
            data: [{ path: "knowledge/requested.md" }],
            page_info: { next: null },
          });
        }
        if (request.method === "GET" && url.pathname.includes("/files/knowledge%2Frequested.md")) {
          return Response.json({
            path: "knowledge/different.md",
            content: "Content from the wrong file",
          });
        }
        throw new Error(`Unhandled ${request.method} ${url.pathname}`);
      },
      async () => {
        const store = ragStore({ model: "test/demo", contentDir: "knowledge" });
        const error = await assertRejects(() =>
          runWithRequestContext(
            {
              projectSlug: "cloud-project",
              token: "vf_request_token",
              productionMode: true,
              releaseId: "rel-abc",
            },
            () => store.indexContentDir(),
          )
        );
        assertInstanceOf(error, Error);
        assertEquals(error.message, "Veryfront Cloud returned an invalid file response");
      },
    );
  });

  it("refreshes cloud document chunks and embeddings under the existing id", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_cloud");
    setEnv("VERYFRONT_PROJECT_SLUG", "cloud-project");
    registerTestEmbeddingProvider();

    const fileChunks = new Map<
      string,
      Array<{
        id: string;
        index: number;
        content: string;
        metadata?: Record<string, unknown>;
      }>
    >([
      [
        ".veryfront/rag/documents/doc-pptx.pptx",
        [{
          id: "old-chunk",
          index: 0,
          content: "Old flat PPTX content",
          metadata: {
            kind: "rag-document",
            document_id: "doc-pptx",
            title: "Old Deck",
            source: "upload:old.pptx",
            type: "pptx",
          },
        }],
      ],
    ]);
    const ragDocuments = new Map<string, {
      id: string;
      title: string;
      source: string;
      type: string;
      created_at: string;
      updated_at: string;
      metadata?: Record<string, unknown>;
    }>([
      [
        "doc-pptx",
        {
          id: "doc-pptx",
          title: "Old Deck",
          source: "upload:old.pptx",
          type: "pptx",
          created_at: "2026-06-25T00:00:00.000Z",
          updated_at: "2026-06-25T00:00:00.000Z",
          metadata: { filePath: ".veryfront/rag/documents/doc-pptx.pptx" },
        },
      ],
    ]);
    const embeddingVectors = new Map<string, number[]>();
    const deletedFilePaths: string[] = [];

    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        const path = url.pathname;

        const ragDocMatch = path.match(/^\/projects\/[^/]+\/rag\/documents(?:\/(.+))?$/);
        if (ragDocMatch !== null) {
          const docId = ragDocMatch[1] ? decodeURIComponent(ragDocMatch[1]) : null;

          if (request.method === "GET" && !docId) {
            return Response.json({
              documents: [...ragDocuments.values()],
            });
          }

          if (request.method === "POST" && !docId) {
            const body = await request.json() as {
              id: string;
              title: string;
              source: string;
              type: string;
              metadata?: Record<string, unknown>;
            };
            ragDocuments.set(body.id, {
              ...body,
              created_at: ragDocuments.get(body.id)?.created_at ??
                "2026-06-25T00:00:00.000Z",
              updated_at: "2026-06-25T01:00:00.000Z",
            });
            return Response.json({ document: ragDocuments.get(body.id) });
          }
        }

        const fileMatch = path.match(/^\/projects\/[^/]+\/branches\/[^/]+\/files\/(.+)\/chunks$/);
        const filePath = fileMatch ? decodeURIComponent(fileMatch[1]!) : null;

        if (request.method === "DELETE" && filePath) {
          deletedFilePaths.push(filePath);
          fileChunks.delete(filePath);
          return Response.json({ deleted: 1 });
        }

        if (request.method === "POST" && filePath) {
          const body = await request.json() as {
            chunks: Array<{
              chunk_index: number;
              content: string;
              metadata?: Record<string, unknown>;
            }>;
          };
          const stored = body.chunks.map((chunk) => ({
            id: `${filePath}:${chunk.chunk_index}`,
            index: chunk.chunk_index,
            content: chunk.content,
            metadata: chunk.metadata,
          }));
          fileChunks.set(filePath, stored);

          return Response.json({
            chunks: stored.map(({ id, index }) => ({ id, index })),
            created: stored.length,
            updated: 0,
          });
        }

        if (request.method === "POST" && path.endsWith("/embeddings")) {
          const body = await request.json() as {
            chunk_ids: string[];
            vectors: number[][];
          };
          body.chunk_ids.forEach((chunkId, index) => {
            embeddingVectors.set(chunkId, body.vectors[index]!);
          });

          return Response.json({
            embeddings: body.chunk_ids.map((chunkId) => ({
              id: `embedding:${chunkId}`,
              model: "test/demo",
              status: "ready",
              created_at: new Date().toISOString(),
            })),
            created: body.chunk_ids.length,
            updated: 0,
          });
        }

        return new Response(`Unhandled ${request.method} ${path}`, { status: 404 });
      },
      async () => {
        const store = ragStore({
          model: "test/demo",
        });

        const refresh = store.refreshDocument;
        assert(refresh);
        await refresh("doc-pptx", "# Better Deck\n\nBody text", {
          title: "Better Deck",
          source: "upload:better.pptx",
          type: "pptx",
        });

        assertEquals(deletedFilePaths, [".veryfront/rag/documents/doc-pptx.pptx"]);
        const refreshedDocument = [...ragDocuments.values()][0];
        const refreshedFilePath = refreshedDocument?.metadata?.filePath;
        assertEquals(typeof refreshedFilePath, "string");
        assertEquals(
          (refreshedFilePath as string).startsWith(
            ".veryfront/rag/documents/doc-pptx.refresh-",
          ),
          true,
        );
        assertEquals((refreshedFilePath as string).endsWith(".pptx"), true);
        assertEquals(refreshedDocument, {
          id: "doc-pptx",
          title: "Better Deck",
          source: "upload:better.pptx",
          type: "pptx",
          created_at: "2026-06-25T00:00:00.000Z",
          updated_at: "2026-06-25T01:00:00.000Z",
          metadata: { filePath: refreshedFilePath },
        });
        const chunks = fileChunks.get(refreshedFilePath as string) ?? [];
        assertEquals(chunks.length, 1);
        assertEquals(chunks[0]?.content, "# Better Deck\n\nBody text");
        assertEquals(chunks[0]?.metadata, {
          kind: "rag-document",
          document_id: "doc-pptx",
          title: "Better Deck",
          source: "upload:better.pptx",
          type: "pptx",
        });
        assertEquals(embeddingVectors.size, 1);

        const listedDocuments = await store.listDocuments() as unknown as Array<
          Record<string, unknown>
        >;
        assertEquals("filePath" in listedDocuments[0]!, false);
      },
    );
  });

  it("keeps old cloud chunks when refresh replacement embedding persistence fails", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_cloud");
    setEnv("VERYFRONT_PROJECT_SLUG", "cloud-project");
    registerTestEmbeddingProvider();

    const fileChunks = new Map<
      string,
      Array<{ id: string; index: number; content: string; metadata?: Record<string, unknown> }>
    >([
      [
        ".veryfront/rag/documents/doc-pptx.pptx",
        [{
          id: "old-chunk",
          index: 0,
          content: "Old flat PPTX content",
          metadata: {
            kind: "rag-document",
            document_id: "doc-pptx",
            title: "Old Deck",
            source: "upload:old.pptx",
            type: "pptx",
          },
        }],
      ],
    ]);
    const ragDocuments = new Map<string, {
      id: string;
      title: string;
      source: string;
      type: string;
      created_at: string;
      updated_at: string;
      metadata?: Record<string, unknown>;
    }>([
      [
        "doc-pptx",
        {
          id: "doc-pptx",
          title: "Old Deck",
          source: "upload:old.pptx",
          type: "pptx",
          created_at: "2026-06-25T00:00:00.000Z",
          updated_at: "2026-06-25T00:00:00.000Z",
          metadata: { filePath: ".veryfront/rag/documents/doc-pptx.pptx" },
        },
      ],
    ]);
    const deletedFilePaths: string[] = [];

    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        const path = url.pathname;

        const ragDocMatch = path.match(/^\/projects\/[^/]+\/rag\/documents(?:\/(.+))?$/);
        if (ragDocMatch !== null && request.method === "GET" && !ragDocMatch[1]) {
          return Response.json({ documents: [...ragDocuments.values()] });
        }

        const fileMatch = path.match(/^\/projects\/[^/]+\/branches\/[^/]+\/files\/(.+)\/chunks$/);
        const filePath = fileMatch ? decodeURIComponent(fileMatch[1]!) : null;

        if (request.method === "DELETE" && filePath) {
          deletedFilePaths.push(filePath);
          fileChunks.delete(filePath);
          return Response.json({ deleted: 1 });
        }

        if (request.method === "POST" && filePath) {
          const body = await request.json() as {
            chunks: Array<{
              chunk_index: number;
              content: string;
              metadata?: Record<string, unknown>;
            }>;
          };
          const stored = body.chunks.map((chunk) => ({
            id: `${filePath}:${chunk.chunk_index}`,
            index: chunk.chunk_index,
            content: chunk.content,
            metadata: chunk.metadata,
          }));
          fileChunks.set(filePath, stored);
          return Response.json({
            chunks: stored.map(({ id, index }) => ({ id, index })),
            created: stored.length,
            updated: 0,
          });
        }

        if (request.method === "POST" && path.endsWith("/embeddings")) {
          return new Response("embedding write failed", { status: 500 });
        }

        return new Response(`Unhandled ${request.method} ${path}`, { status: 404 });
      },
      async () => {
        const store = ragStore({ model: "test/demo" });
        const refresh = store.refreshDocument;
        assert(refresh);

        await assertRejects(
          () => refresh("doc-pptx", "# Better Deck\n\nBody text"),
          Error,
          "Veryfront Cloud RAG request failed with status 500",
        );

        assertEquals(deletedFilePaths.includes(".veryfront/rag/documents/doc-pptx.pptx"), false);
        assertEquals(
          fileChunks.get(".veryfront/rag/documents/doc-pptx.pptx")?.[0]?.content,
          "Old flat PPTX content",
        );
        assertEquals(ragDocuments.get("doc-pptx")?.title, "Old Deck");
      },
    );
  });

  it("returns empty results for whitespace-only cloud queries without making requests", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_cloud");
    setEnv("VERYFRONT_PROJECT_SLUG", "cloud-project");

    let fetchCalls = 0;

    await withMockFetch(
      async () => {
        fetchCalls++;
        throw new Error("fetch should not run for whitespace-only queries");
      },
      async () => {
        const store = ragStore({
          model: "test/demo",
        });

        const results = await store.search("   ");
        assertEquals(results, []);
        assertEquals(fetchCalls, 0);
      },
    );
  });

  it("resolves cloud backend from request-scoped credentials at call time", async () => {
    registerTestEmbeddingProvider();

    const urls: string[] = [];
    const fileChunks = new Map<string, Array<{ id: string; index: number; content: string }>>();

    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        urls.push(url.toString());

        const fileMatch = url.pathname.match(
          /^\/projects\/([^/]+)\/branches\/([^/]+)\/files\/(.+)\/chunks$/,
        );
        const filePath = fileMatch ? decodeURIComponent(fileMatch[3] ?? "") : null;

        if (request.method === "GET" && filePath) {
          const chunks = fileChunks.get(filePath);
          if (!chunks) return new Response("Not found", { status: 404 });
          return Response.json({ data: chunks, page_info: { next: null } });
        }

        if (request.method === "POST" && filePath) {
          const body = await request.json() as {
            chunks: Array<{ chunk_index: number; content: string }>;
          };
          const stored = body.chunks.map((chunk) => ({
            id: `${filePath}:${chunk.chunk_index}`,
            index: chunk.chunk_index,
            content: chunk.content,
          }));
          fileChunks.set(filePath, stored);
          return Response.json({
            chunks: stored.map(({ id, index }) => ({ id, index })),
            created: stored.length,
            updated: 0,
          });
        }

        if (request.method === "POST" && url.pathname.endsWith("/embeddings")) {
          return Response.json({
            embeddings: [{ id: "embedding-1", model: "test/demo", status: "ready" }],
            created: 1,
            updated: 0,
          });
        }

        // RAG document management
        if (url.pathname.match(/\/rag\/documents(\/|$)/)) {
          if (request.method === "POST") {
            const body = await request.json() as { id: string };
            return Response.json({ id: body.id });
          }
          return Response.json({ documents: [] });
        }

        throw new Error(`Unhandled ${request.method} ${url.pathname}`);
      },
      async () => {
        const store = ragStore({
          model: "test/demo",
        });

        await runWithRequestContext(
          {
            projectSlug: "request-project",
            token: "vf_request_token",
          },
          async () => {
            await store.ingest("Scoped Doc", "request scoped content", {
              source: "upload:scoped.txt",
              type: "txt",
            });
          },
        );

        // All requests should target the request-scoped project, not any env-based slug
        assertEquals(
          urls.every((u) => u.includes("/projects/request-project/")),
          true,
          `Expected all URLs to target request-project, got: ${urls[0]}`,
        );
      },
    );
  });

  it("indexes contentDir from published release files in request context", async () => {
    registerTestEmbeddingProvider();

    const ragDocuments = new Map<string, {
      id: string;
      title: string;
      source: string;
      type: string;
      created_at: string;
      updated_at: string;
      metadata?: Record<string, unknown>;
    }>();
    const fileChunks = new Map<
      string,
      Array<{
        id: string;
        index: number;
        content: string;
        metadata?: Record<string, unknown>;
      }>
    >();
    const requestedPaths: string[] = [];

    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        requestedPaths.push(url.pathname);

        if (
          request.method === "GET" &&
          url.pathname === "/projects/cloud-project/releases/rel-abc/files"
        ) {
          return Response.json({
            data: [
              {
                id: "file-login",
                version_id: "version-login",
                path: "knowledge/login-troubleshooting.md",
                content: "# Login troubleshooting\n\nEscalate blocked SSO login issues.",
                size: 62,
                type: "file",
                updated_at: "2026-06-25T00:00:00.000Z",
                release_id: "rel-abc",
                release_version: "0.0.1",
              },
            ],
            page_info: { next: null },
            release_id: "rel-abc",
            release_version: "0.0.1",
          });
        }

        const ragDocMatch = url.pathname.match(/^\/projects\/[^/]+\/rag\/documents(?:\/(.+))?$/);
        if (ragDocMatch !== null) {
          const docId = ragDocMatch[1] ? decodeURIComponent(ragDocMatch[1]) : null;

          if (request.method === "GET" && !docId) {
            return Response.json({ documents: [...ragDocuments.values()] });
          }

          if (request.method === "POST" && !docId) {
            const body = await request.json() as {
              id: string;
              title: string;
              source: string;
              type: string;
              metadata?: Record<string, unknown>;
            };
            ragDocuments.set(body.id, {
              ...body,
              created_at: "2026-06-25T00:00:00.000Z",
              updated_at: "2026-06-25T00:00:00.000Z",
            });
            return Response.json({ document: ragDocuments.get(body.id) });
          }
        }

        const fileMatch = url.pathname.match(
          /^\/projects\/[^/]+\/branches\/[^/]+\/files\/(.+)\/chunks$/,
        );
        const filePath = fileMatch ? decodeURIComponent(fileMatch[1] ?? "") : null;

        if (request.method === "POST" && filePath) {
          const body = await request.json() as {
            chunks: Array<{
              chunk_index: number;
              content: string;
              metadata?: Record<string, unknown>;
            }>;
          };
          const stored = body.chunks.map((chunk) => ({
            id: `${filePath}:${chunk.chunk_index}`,
            index: chunk.chunk_index,
            content: chunk.content,
            metadata: chunk.metadata,
          }));
          fileChunks.set(filePath, stored);
          return Response.json({
            chunks: stored.map(({ id, index }) => ({ id, index })),
          });
        }

        if (request.method === "POST" && url.pathname.endsWith("/embeddings")) {
          return Response.json({
            embeddings: [{ id: "embedding-1", model: "test/demo", status: "ready" }],
          });
        }

        throw new Error(`Unhandled ${request.method} ${url.pathname}`);
      },
      async () => {
        const store = ragStore({
          contentDir: "knowledge",
          model: "test/demo",
        });

        await runWithRequestContext(
          {
            projectSlug: "cloud-project",
            token: "vf_request_token",
            productionMode: true,
            releaseId: "rel-abc",
          },
          () => store.indexContentDir(),
        );

        const documents = [...ragDocuments.values()];
        assertEquals(documents.length, 1);
        assertEquals(documents[0]?.title, "login-troubleshooting");
        assertEquals(documents[0]?.source, "knowledge/login-troubleshooting.md");
        assertEquals(fileChunks.size, 1);
        assertEquals(
          requestedPaths.includes("/projects/cloud-project/releases/rel-abc/files"),
          true,
        );
      },
    );
  });

  it("respects VERYFRONT_RAG_BACKEND=local-json as an override", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_cloud");
    setEnv("VERYFRONT_PROJECT_SLUG", "cloud-project");
    setEnv("VERYFRONT_RAG_BACKEND", "local-json");

    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const store = ragStore({
        model: "local/test-model",
        storagePath,
      });

      const id = await store.ingest("Local Doc", "Hello local override", {
        source: "upload:local.txt",
        type: "txt",
      });

      const documents = await store.listDocuments();
      assertEquals(documents.length, 1);
      assertEquals(documents[0]?.id, id);
      assertEquals(await exists(storagePath), true);
    });
  });
});
