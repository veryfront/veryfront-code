import { assert, assertEquals } from "#veryfront/testing/assert.ts";
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

      const parsed = JSON.parse(await readTextFile(storagePath)) as {
        documents: unknown[];
        chunks: unknown[];
      };
      assertEquals(Array.isArray(parsed.documents), true);
      assertEquals(Array.isArray(parsed.chunks), true);
      assertEquals(await exists(storagePath + ".tmp"), false);
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

    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        const path = url.pathname;
        authHeaders.push(request.headers.get("authorization"));

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

        await store.removeDocument(id);
        assertEquals(await store.listDocuments(), []);
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
