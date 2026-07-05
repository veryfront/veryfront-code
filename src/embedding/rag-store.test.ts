import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { exists, readTextFile, withTempDir } from "#veryfront/testing/deno-compat.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { join } from "#veryfront/compat/path";
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

  it("resets local store when document entries fail validation", async () => {
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

      assertEquals(await store.listDocuments(), []);
    });
  });

  it("resets local store when chunk entries fail validation", async () => {
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

      assertEquals(await store.listDocuments(), []);
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
          const manifestChunks = fileChunks.get(".veryfront/rag/manifest.json") ?? [];
          const documentFilePath = [...fileChunks.keys()].find((key) =>
            key.startsWith(".veryfront/rag/documents/")
          );
          const documentChunks = documentFilePath ? (fileChunks.get(documentFilePath) ?? []) : [];

          return Response.json({
            data: [
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
            ],
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

        const listedDocuments = await store.listDocuments() as Array<Record<string, unknown>>;
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
          "embedding write failed",
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
