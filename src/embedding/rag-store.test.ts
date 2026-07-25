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
        schemaVersion?: number;
        documents: unknown[];
        chunks: unknown[];
      };
      assertEquals(parsed.schemaVersion, 1);
      assertEquals(Array.isArray(parsed.documents), true);
      assertEquals(Array.isArray(parsed.chunks), true);
      assertEquals(persisted, JSON.stringify(parsed));
      assertEquals(await exists(storagePath + ".tmp"), false);
      const temporaryEntries: string[] = [];
      for await (const entry of Deno.readDir(join(tempDir, "data"))) {
        if (entry.name.startsWith("index.json.tmp.")) temporaryEntries.push(entry.name);
      }
      assertEquals(temporaryEntries, []);
    });
  });

  it("serializes concurrent writes from independent stores sharing a path", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const stores = Array.from(
        { length: 20 },
        () =>
          ragStore({
            model: "local/test-model",
            storagePath,
          }),
      );

      await Promise.all(
        stores.map((store, index) =>
          store.ingest(`Doc ${index}`, `Content ${index}`, {
            source: `upload:${index}.txt`,
            type: "txt",
          })
        ),
      );

      const documents = await stores[0]!.listDocuments();
      assertEquals(documents.length, stores.length);
      assertEquals(
        new Set(documents.map((document) => document.source)).size,
        stores.length,
      );
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
    registerTestEmbeddingProvider();

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
            embedding: [999, 999],
            index: 0,
          }],
        }),
      );

      const store = ragStore({
        model: "test/demo",
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

      await store.search("legacy");
      const migrated = JSON.parse(await readTextFile(storagePath)) as {
        schemaVersion?: number;
        embeddingFingerprint?: {
          model: string;
          documentPrefix: string;
          dimension: number;
        };
        chunks: Array<{ embedding: number[] }>;
      };
      assertEquals(migrated.schemaVersion, 1);
      assertEquals(migrated.embeddingFingerprint, {
        model: "test/demo",
        documentPrefix: "",
        dimension: 1536,
      });
      assertEquals(migrated.chunks[0]?.embedding.length, 1536);
    });
  });

  it("fails closed without overwriting invalid document entries", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      await Deno.mkdir(join(tempDir, "data"), { recursive: true });
      const original = JSON.stringify({
        documents: [{
          id: 123,
          title: "Invalid Doc",
          source: "upload:invalid.txt",
          type: "txt",
          createdAt: 1,
        }],
        chunks: [],
      });
      await Deno.writeTextFile(storagePath, original);

      const store = ragStore({
        model: "local/test-model",
        storagePath,
      });

      await assertRejects(
        () => store.listDocuments(),
        Error,
        "failed validation",
      );
      await assertRejects(
        () => store.ingest("Replacement", "must not overwrite"),
        Error,
        "failed validation",
      );
      assertEquals(await readTextFile(storagePath), original);
    });
  });

  it("fails closed without overwriting invalid chunk entries", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      await Deno.mkdir(join(tempDir, "data"), { recursive: true });
      const original = JSON.stringify({
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
      });
      await Deno.writeTextFile(storagePath, original);

      const store = ragStore({
        model: "local/test-model",
        storagePath,
      });

      await assertRejects(
        () => store.listDocuments(),
        Error,
        "failed validation",
      );
      assertEquals(await readTextFile(storagePath), original);
    });
  });

  it("fails closed without overwriting malformed JSON", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      await Deno.mkdir(join(tempDir, "data"), { recursive: true });
      const original = '{"documents":[';
      await Deno.writeTextFile(storagePath, original);

      const store = ragStore({
        model: "local/test-model",
        storagePath,
      });

      await assertRejects(
        () => store.listDocuments(),
        Error,
        "malformed JSON",
      );
      await assertRejects(
        () => store.removeDocument("anything"),
        Error,
        "malformed JSON",
      );
      assertEquals(await readTextFile(storagePath), original);
    });
  });

  it("rejects blank ingest and refresh content without mutating the store", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const store = ragStore({
        model: "local/test-model",
        storagePath,
      });

      await assertRejects(
        () => store.ingest("Blank", " \n\t "),
        Error,
        "no extractable text",
      );
      assertEquals(await store.listDocuments(), []);

      const id = await store.ingest("Valid", "Preserve this content");
      const before = await readTextFile(storagePath);
      const refresh = store.refreshDocument;
      assert(refresh);
      await assertRejects(
        () => refresh(id, "   "),
        Error,
        "no extractable text",
      );
      assertEquals(await readTextFile(storagePath), before);
    });
  });

  it("re-embeds persisted chunks when model or document prefix changes", async () => {
    const embeddingCalls: Array<{ model: string; values: string[] }> = [];
    registerEmbeddingProvider("fingerprint", (modelId) =>
      ({
        specificationVersion: "v2",
        provider: "fingerprint",
        modelId,
        supportsParallelCalls: true,
        async doEmbed({ values }: { values: string[] }) {
          embeddingCalls.push({ model: modelId, values: [...values] });
          return {
            embeddings: values.map((value) =>
              modelId === "v1" ? [value.length, 1] : [1, value.length]
            ),
            usage: { tokens: 0 },
            warnings: [],
          };
        },
      }) as never);

    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const first = ragStore({
        model: "fingerprint/v1",
        storagePath,
      });
      await first.ingest("Doc", "alpha content");
      await first.search("alpha");

      const firstPersisted = JSON.parse(await readTextFile(storagePath)) as {
        embeddingFingerprint: {
          model: string;
          documentPrefix: string;
          dimension: number;
        };
        chunks: Array<{ embedding: number[] }>;
      };
      assertEquals(firstPersisted.embeddingFingerprint, {
        model: "fingerprint/v1",
        documentPrefix: "",
        dimension: 2,
      });
      assertEquals(firstPersisted.chunks[0]?.embedding, [13, 1]);

      const second = ragStore({
        model: "fingerprint/v2",
        storagePath,
      });
      await second.search("alpha");
      const secondPersisted = JSON.parse(await readTextFile(storagePath)) as {
        embeddingFingerprint: {
          model: string;
          documentPrefix: string;
          dimension: number;
        };
        chunks: Array<{ embedding: number[] }>;
      };
      assertEquals(secondPersisted.embeddingFingerprint, {
        model: "fingerprint/v2",
        documentPrefix: "",
        dimension: 2,
      });
      assertEquals(secondPersisted.chunks[0]?.embedding, [1, 13]);

      const prefixed = ragStore({
        model: "fingerprint/v2",
        documentPrefix: "document: ",
        storagePath,
      });
      await prefixed.search("alpha");
      const prefixedPersisted = JSON.parse(await readTextFile(storagePath)) as {
        embeddingFingerprint: {
          model: string;
          documentPrefix: string;
          dimension: number;
        };
        chunks: Array<{ embedding: number[] }>;
      };
      assertEquals(prefixedPersisted.embeddingFingerprint, {
        model: "fingerprint/v2",
        documentPrefix: "document: ",
        dimension: 2,
      });
      assertEquals(prefixedPersisted.chunks[0]?.embedding, [1, 23]);
      assertEquals(
        embeddingCalls.some((call) =>
          call.model === "v2" && call.values.includes("document: alpha content")
        ),
        true,
      );
    });
  });

  it("leaves persisted vectors unchanged when model migration fails", async () => {
    registerEmbeddingProvider("fingerprint-failure", (modelId) =>
      ({
        specificationVersion: "v2",
        provider: "fingerprint-failure",
        modelId,
        supportsParallelCalls: true,
        async doEmbed({ values }: { values: string[] }) {
          if (modelId === "v2") throw new Error("provider unavailable");
          return {
            embeddings: values.map(() => [1, 0]),
            usage: { tokens: 0 },
            warnings: [],
          };
        },
      }) as never);

    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const first = ragStore({
        model: "fingerprint-failure/v1",
        storagePath,
      });
      await first.ingest("Doc", "stable content");
      await first.search("stable");
      const before = await readTextFile(storagePath);

      const second = ragStore({
        model: "fingerprint-failure/v2",
        storagePath,
      });
      await assertRejects(
        () => second.search("stable"),
        Error,
        "provider unavailable",
      );
      assertEquals(await readTextFile(storagePath), before);
    });
  });

  it("validates local search controls before invoking an embedder", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const store = ragStore({
        model: "local/test-model",
        storagePath,
      });

      for (
        const options of [
          { topK: 0 },
          { topK: -1 },
          { topK: 1.5 },
          { topK: 10_001 },
          { threshold: Number.NaN },
          { threshold: -0.1 },
          { threshold: 1.1 },
        ]
      ) {
        await assertRejects(
          () => store.search("query", options),
          RangeError,
        );
      }

      const controller = new AbortController();
      controller.abort(new Error("cancelled"));
      await assertRejects(
        () => store.search("query", { abortSignal: controller.signal }),
        Error,
        "cancelled",
      );
    });
  });

  it("bounds local JSON store reads before parsing", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      await Deno.mkdir(join(tempDir, "data"), { recursive: true });
      const original = JSON.stringify({ documents: [], chunks: [] });
      await Deno.writeTextFile(storagePath, original);
      const store = ragStore({
        model: "local/test-model",
        storagePath,
        maxStorageBytes: original.length - 1,
      });

      await assertRejects(
        () => store.listDocuments(),
        RangeError,
        "maxStorageBytes",
      );
      assertEquals(await readTextFile(storagePath), original);
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
    const deletionOrder: string[] = [];

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
            deletionOrder.push("document");
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
          deletionOrder.push("chunks");
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
          const documentEntries = [...fileChunks.entries()].filter(([key]) =>
            key.startsWith(".veryfront/rag/documents/")
          );

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
              ...documentEntries.flatMap(([documentFilePath, documentChunks]) =>
                documentChunks.map((chunk) => ({
                  chunk: {
                    file_path: documentFilePath,
                    content: chunk.content,
                    metadata: chunk.metadata,
                  },
                  score: documentFilePath.includes("stale") ? 0.98 : 0.91,
                }))
              ),
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

        fileChunks.set(".veryfront/rag/documents/stale.txt", [{
          id: "stale",
          index: 0,
          content: "stale replacement",
          metadata: {
            kind: "rag-document",
            document_id: id,
            title: "Stale",
            source: "upload:stale.txt",
            type: "txt",
            branch: "main",
          },
        }]);
        fileChunks.set(".veryfront/rag/documents/orphan.txt", [{
          id: "orphan",
          index: 0,
          content: "orphaned content",
          metadata: {
            kind: "rag-document",
            document_id: "missing-document",
            title: "Orphan",
            source: "upload:orphan.txt",
            type: "txt",
            branch: "main",
          },
        }]);

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
        assertEquals(deletionOrder, ["chunks", "document"]);
      },
    );
  });

  it("isolates cloud document metadata by branch while retaining main-branch legacy records", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_cloud");
    setEnv("VERYFRONT_PROJECT_SLUG", "cloud-project");
    const documents = [
      {
        id: "main-doc",
        title: "Main",
        source: "main.md",
        type: "md",
        created_at: "2026-06-25T00:00:00.000Z",
        updated_at: "2026-06-25T00:00:00.000Z",
        metadata: { branch: "main", filePath: "main-path" },
      },
      {
        id: "feature-doc",
        title: "Feature",
        source: "feature.md",
        type: "md",
        created_at: "2026-06-25T00:00:00.000Z",
        updated_at: "2026-06-25T00:00:00.000Z",
        metadata: { branch: "feature", filePath: "feature-path" },
      },
      {
        id: "legacy-doc",
        title: "Legacy",
        source: "legacy.md",
        type: "md",
        created_at: "2026-06-25T00:00:00.000Z",
        updated_at: "2026-06-25T00:00:00.000Z",
        metadata: { filePath: "legacy-path" },
      },
    ];

    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        if (request.method === "GET" && new URL(request.url).pathname.endsWith("/rag/documents")) {
          return Response.json({ documents });
        }
        throw new Error(`Unhandled ${request.method} ${request.url}`);
      },
      async () => {
        const feature = ragStore({
          branch: "feature",
          model: "test/demo",
        });
        const main = ragStore({
          branch: "main",
          model: "test/demo",
        });

        assertEquals(
          (await feature.listDocuments()).map((document) => document.id),
          ["feature-doc"],
        );
        assertEquals(
          (await main.listDocuments()).map((document) => document.id),
          ["main-doc", "legacy-doc"],
        );
      },
    );
  });

  it("removes new chunks when cloud document publication fails", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_cloud");
    setEnv("VERYFRONT_PROJECT_SLUG", "cloud-project");
    registerTestEmbeddingProvider();
    const storedPaths = new Set<string>();
    const deletedPaths: string[] = [];
    let documentRollbackDeletes = 0;

    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        const fileMatch = url.pathname.match(
          /^\/projects\/[^/]+\/branches\/[^/]+\/files\/(.+)\/chunks$/,
        );
        const filePath = fileMatch ? decodeURIComponent(fileMatch[1]!) : null;

        if (request.method === "POST" && filePath) {
          const body = await request.json() as {
            chunks: Array<{ chunk_index: number }>;
          };
          storedPaths.add(filePath);
          return Response.json({
            chunks: body.chunks.map((entry) => ({
              id: `${filePath}:${entry.chunk_index}`,
              index: entry.chunk_index,
            })),
          });
        }
        if (request.method === "DELETE" && filePath) {
          storedPaths.delete(filePath);
          deletedPaths.push(filePath);
          return Response.json({ deleted: 1 });
        }
        if (request.method === "POST" && url.pathname.endsWith("/embeddings")) {
          const body = await request.json() as { chunk_ids: string[] };
          return Response.json({
            embeddings: body.chunk_ids.map((id) => ({ id: `embedding:${id}` })),
          });
        }
        if (request.method === "POST" && url.pathname.endsWith("/rag/documents")) {
          return new Response("document publication failed", { status: 500 });
        }
        if (
          request.method === "DELETE" &&
          url.pathname.includes("/rag/documents/")
        ) {
          documentRollbackDeletes++;
          return Response.json({ deleted: 0 });
        }
        throw new Error(`Unhandled ${request.method} ${url.pathname}`);
      },
      async () => {
        const store = ragStore({ model: "test/demo" });
        await assertRejects(
          () => store.ingest("Doc", "content"),
          Error,
          "request failed (500",
        );
        assertEquals(storedPaths.size, 0);
        assertEquals(deletedPaths.length, 1);
        assertEquals(documentRollbackDeletes, 1);
      },
    );
  });

  it("does not report cloud deletion success when searchable chunk cleanup fails", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_cloud");
    setEnv("VERYFRONT_PROJECT_SLUG", "cloud-project");
    let documentDeleteCalled = false;

    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        if (request.method === "GET" && url.pathname.endsWith("/rag/documents")) {
          return Response.json({
            documents: [{
              id: "doc-1",
              title: "Doc",
              source: "upload:doc.txt",
              type: "txt",
              created_at: "2026-06-25T00:00:00.000Z",
              updated_at: "2026-06-25T00:00:00.000Z",
              metadata: {
                branch: "main",
                filePath: ".veryfront/rag/documents/doc-1.txt",
              },
            }],
          });
        }
        if (
          request.method === "DELETE" &&
          url.pathname.includes("/branches/") &&
          url.pathname.endsWith("/chunks")
        ) {
          return new Response("chunk cleanup failed", { status: 500 });
        }
        if (request.method === "DELETE" && url.pathname.endsWith("/rag/documents/doc-1")) {
          documentDeleteCalled = true;
          return Response.json({ deleted: 1 });
        }
        throw new Error(`Unhandled ${request.method} ${url.pathname}`);
      },
      async () => {
        const store = ragStore({ model: "test/demo" });
        await assertRejects(
          () => store.removeDocument("doc-1"),
          Error,
          "request failed (500",
        );
        assertEquals(documentDeleteCalled, false);
      },
    );
  });

  it("rejects malformed cloud document responses", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_cloud");
    setEnv("VERYFRONT_PROJECT_SLUG", "cloud-project");

    await withMockFetch(
      () =>
        Promise.resolve(
          Response.json({
            documents: [{
              id: 123,
              title: "Malformed",
            }],
          }),
        ),
      async () => {
        const store = ragStore({ model: "test/demo" });
        await assertRejects(
          () => store.listDocuments(),
          Error,
          "failed validation",
        );
      },
    );
  });

  it("bounds published-file pagination and rejects cursor cycles", async () => {
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
        if (
          request.method === "GET" &&
          url.pathname === "/projects/cloud-project/releases/rel-cycle/files"
        ) {
          fileListCalls++;
          return Response.json({
            data: [],
            page_info: { next: "same-cursor" },
          });
        }
        throw new Error(`Unhandled ${request.method} ${url.pathname}`);
      },
      async () => {
        const store = ragStore({
          contentDir: "knowledge",
          model: "test/demo",
        });
        await assertRejects(
          () =>
            runWithRequestContext(
              {
                projectSlug: "cloud-project",
                token: "vf_request_token",
                productionMode: true,
                releaseId: "rel-cycle",
              },
              () => store.indexContentDir(),
            ),
          Error,
          "repeated a cursor",
        );
        assertEquals(fileListCalls, 2);
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
          metadata: { filePath: refreshedFilePath, branch: "main" },
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
          branch: "main",
        });
        assertEquals(embeddingVectors.size, 1);

        const listedDocuments = await store.listDocuments();
        assertEquals(Object.hasOwn(listedDocuments[0]!, "filePath"), false);
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
          "request failed (500",
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

        for (
          const options of [
            { topK: 0 },
            { topK: 101 },
            { threshold: Number.NaN },
            { threshold: -0.1 },
            { threshold: 1.1 },
          ]
        ) {
          await assertRejects(
            () => store.search("query", options),
            RangeError,
          );
        }

        const controller = new AbortController();
        controller.abort(new Error("cloud search cancelled"));
        await assertRejects(
          () => store.search("query", { abortSignal: controller.signal }),
          Error,
          "cloud search cancelled",
        );
        await assertRejects(
          () => store.ingest("Blank", " \n\t "),
          Error,
          "no extractable text",
        );
        assertEquals(fetchCalls, 0);
      },
    );
  });

  it("propagates cloud search cancellation into the outbound request", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_cloud");
    setEnv("VERYFRONT_PROJECT_SLUG", "cloud-project");
    registerTestEmbeddingProvider();
    const searchStarted = Promise.withResolvers<void>();

    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        if (
          request.method === "POST" &&
          new URL(request.url).pathname.endsWith("/search")
        ) {
          searchStarted.resolve();
          return await new Promise<Response>((_resolve, reject) => {
            const rejectForAbort = () => reject(request.signal.reason);
            if (request.signal.aborted) rejectForAbort();
            else {
              request.signal.addEventListener("abort", rejectForAbort, {
                once: true,
              });
            }
          });
        }
        throw new Error(`Unhandled ${request.method} ${request.url}`);
      },
      async () => {
        const controller = new AbortController();
        const store = ragStore({ model: "test/demo" });
        const search = store.search("cancel me", {
          abortSignal: controller.signal,
        });
        await searchStarted.promise;
        controller.abort(new Error("caller stopped"));

        await assertRejects(
          () => search,
          Error,
          "caller stopped",
        );
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
