import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { exists, readTextFile, withTempDir } from "#veryfront/testing/deno-compat.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { join } from "#veryfront/compat/path";
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

function withMockFetch<T>(
  mockFetch: typeof globalThis.fetch,
  fn: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  return fn().finally(() => {
    globalThis.fetch = originalFetch;
  });
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
