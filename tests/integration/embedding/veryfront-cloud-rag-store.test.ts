import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  clearEmbeddingProviders,
  registerEmbeddingProvider,
} from "#veryfront/embedding/resolve.ts";
import { createVeryfrontCloudRagStore } from "#veryfront/embedding/veryfront-cloud/rag-store.ts";

type StoredChunk = {
  id: string;
  index: number;
  content: string;
  metadata: Record<string, unknown>;
};
type Document = { id: string; title: string; metadata: Record<string, unknown> };

function replacementApi() {
  const files = new Map<string, StoredChunk[]>();
  const documents = new Map<string, Document>();
  const embeddings = new Set<string>();
  const writes: string[] = [];
  let failWrite = 0;
  let failedDeletePath: string | undefined;
  let metadataFailure: "before" | "after" | "transport-after" | "delayed" | undefined;
  let delayedMetadata: Document | undefined;
  let deletionPause: { entered: () => void; wait: Promise<void> } | undefined;
  const removeFile = (path: string) => {
    for (const chunk of files.get(path) ?? []) embeddings.delete(chunk.id);
    files.delete(path);
  };
  return {
    files,
    documents,
    embeddings,
    writes,
    failChunkWriteAfter(count: number) {
      failWrite = writes.length + count;
    },
    failDelete(path: string) {
      failedDeletePath = path;
    },
    failMetadata(mode: "before" | "after" | "transport-after" | "delayed") {
      metadataFailure = mode;
    },
    completeDelayedMetadata() {
      assert(delayedMetadata);
      documents.set(delayedMetadata.id, delayedMetadata);
    },
    pauseNextDeletion() {
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      deletionPause = { entered, wait };
      return { started, release };
    },
    async fetch(input: string | URL | Request, init?: RequestInit) {
      const request = input instanceof Request ? input : new Request(input, init);
      const path = new URL(request.url).pathname;
      const fileMatch = path.match(/\/files\/(.+)\/chunks$/);
      if (fileMatch) {
        const filePath = decodeURIComponent(fileMatch[1]!);
        if (request.method === "DELETE") {
          if (deletionPause) {
            const pause = deletionPause;
            deletionPause = undefined;
            pause.entered();
            await pause.wait;
          }
          if (filePath === failedDeletePath) {
            return Response.json({ message: "Fixture cleanup failure" }, { status: 503 });
          }
          removeFile(filePath);
          return Response.json({ deleted: 1 });
        }
        if (request.method === "POST") {
          writes.push(filePath);
          if (writes.length === failWrite) {
            return Response.json({ message: "Fixture write failed" }, { status: 503 });
          }
          const body = await request.json() as {
            chunks: Array<
              { chunk_index: number; content: string; metadata: Record<string, unknown> }
            >;
          };
          assert(body.chunks.length <= 500);
          removeFile(filePath);
          const chunks = body.chunks.map((chunk) => ({
            ...chunk,
            id: crypto.randomUUID(),
            index: chunk.chunk_index,
          }));
          files.set(filePath, chunks);
          return Response.json({ chunks: chunks.map(({ id, index }) => ({ id, index })) });
        }
      }
      if (path.endsWith("/embeddings") && request.method === "POST") {
        const body = await request.json() as { chunk_ids: string[]; vectors: number[][] };
        assert(body.chunk_ids.length <= 100);
        assertEquals(body.chunk_ids.length, body.vectors.length);
        const liveIds = new Set([...files.values()].flat().map((chunk) => chunk.id));
        if (body.chunk_ids.some((id) => !liveIds.has(id))) {
          return Response.json({ message: "Some chunks not found" }, { status: 400 });
        }
        body.chunk_ids.forEach((id) => embeddings.add(id));
        return Response.json({ created: body.chunk_ids.length });
      }
      const documentMatch = path.match(/\/rag\/documents(?:\/([^/]+))?$/);
      if (documentMatch) {
        if (request.method === "GET") return Response.json({ documents: [...documents.values()] });
        if (request.method === "POST") {
          const body = await request.json() as Document;
          const failure = metadataFailure;
          metadataFailure = undefined;
          if (failure === "delayed") {
            delayedMetadata = body;
            return Response.json({ message: "Fixture gateway timeout" }, { status: 504 });
          }
          if (failure === "before") {
            return Response.json({ message: "Fixture metadata rejection" }, { status: 400 });
          }
          documents.set(body.id, { ...body });
          if (failure === "after") {
            return Response.json({ message: "Fixture response failure after commit" }, {
              status: 503,
            });
          }
          if (failure === "transport-after") {
            throw new TypeError("Fixture acknowledgement lost after commit");
          }
          return Response.json({ document: body });
        }
        if (request.method === "DELETE") {
          documents.delete(decodeURIComponent(documentMatch[1]!));
          return Response.json({ deleted: 1 });
        }
      }
      if (path.endsWith("/search")) {
        return Response.json({
          data: [...files].flatMap(([file_path, chunks]) =>
            chunks.slice(-1).map((chunk) => ({ chunk: { ...chunk, file_path }, score: 1 }))
          ),
        });
      }
      throw new Error(`Unexpected fixture route: ${request.method} ${path}`);
    },
  };
}

function store() {
  return createVeryfrontCloudRagStore({
    model: "fixture/deterministic",
    chunkOptions: { maxChars: 10, overlap: 0, separators: [""] },
  });
}

describe("cloud RAG batch replacement", () => {
  beforeEach(() => {
    setEnv("VERYFRONT_API_TOKEN", "fixture-token");
    setEnv("VERYFRONT_PROJECT_SLUG", "fixture-project");
    registerEmbeddingProvider("fixture", () =>
      ({
        specificationVersion: "v2",
        provider: "fixture",
        modelId: "fixture/deterministic",
        maxEmbeddingsPerCall: undefined,
        supportsParallelCalls: true,
        doEmbed({ values }: { values: string[] }) {
          return Promise.resolve({
            embeddings: values.map(() => new Array<number>(768).fill(0)),
            warnings: [],
            usage: { tokens: 0 },
          });
        },
      }) as never);
  });
  afterEach(() => {
    deleteEnv("VERYFRONT_API_TOKEN");
    deleteEnv("VERYFRONT_PROJECT_SLUG");
    clearEmbeddingProviders();
  });

  it("retains and embeds all 501 chunks, refreshes the same document, and removes every part", async () => {
    const api = replacementApi();
    await withMockFetch(api.fetch, async () => {
      const rag = store();
      const text = "abcdefghij".repeat(500) + "lastchunk!";
      const id = await rag.ingest("Large document", text, { type: "txt" });
      assertEquals([...api.files.values()].flat().map((chunk) => chunk.content).join(""), text);
      assertEquals(api.embeddings.size, 501);
      assertEquals((await rag.listDocuments()).map((doc) => doc.id), [id]);
      const results = await rag.search("last chunk", { topK: 10 });
      assertEquals(results.length, 2);
      assert(results.every((result) => result.documentId === id));
      assert(results.some((result) => result.text === "lastchunk!"));
      const originalPaths = [...api.files.keys()];
      assertEquals(originalPaths.length, 2);
      await rag.refreshDocument!(id, "small");
      assertEquals(api.embeddings.size, 1);
      assert(originalPaths.every((path) => !api.files.has(path)));
      assertEquals(api.documents.get(id)!.metadata.cleanupFilePaths, originalPaths);
      const smallPaths = [...api.files.keys()];
      assertEquals([...api.documents.keys()], [id]);
      await rag.refreshDocument!(id, text);
      assertEquals(api.embeddings.size, 501);
      assertEquals(api.documents.get(id)!.metadata.cleanupFilePaths, smallPaths);
      await rag.removeDocument(id);
      assertEquals(api.files.size, 0);
      assertEquals(api.embeddings.size, 0);
      assertEquals(api.documents.size, 0);
    });
  });

  it("cleans failed replacement parts while preserving the previously committed document", async () => {
    const api = replacementApi();
    await withMockFetch(api.fetch, async () => {
      const rag = store();
      const id = await rag.ingest("Existing", "original");
      const originalFiles = [...api.files];
      const originalDocument = api.documents.get(id);
      api.failChunkWriteAfter(2);
      await assertRejects(() => rag.refreshDocument!(id, "abcdefghij".repeat(501)));
      assertEquals([...api.files], originalFiles);
      assertEquals(api.documents.get(id), originalDocument);
      assertEquals(api.embeddings.size, 1);
    });
  });

  it("attempts every old part cleanup even when the first deletion fails", async () => {
    const api = replacementApi();
    await withMockFetch(api.fetch, async () => {
      const rag = store();
      const id = await rag.ingest("Large", "abcdefghij".repeat(1001));
      const oldPaths = [...api.files.keys()];
      assertEquals(oldPaths.length, 3);
      api.failDelete(oldPaths[0]!);
      await assertRejects(() => rag.refreshDocument!(id, "replacement"));
      assert(api.files.has(oldPaths[0]!));
      assert(oldPaths.slice(1).every((path) => !api.files.has(path)));
      assertEquals(api.files.size, 2);
    });
  });

  it("cleans every new part when the metadata response fails and the old document remains authoritative", async () => {
    const api = replacementApi();
    await withMockFetch(api.fetch, async () => {
      const rag = store();
      const id = await rag.ingest("Existing", "original");
      const originalFiles = [...api.files];
      const originalDocument = api.documents.get(id);
      api.failMetadata("before");
      await assertRejects(() => rag.refreshDocument!(id, "abcdefghij".repeat(501)));
      assertEquals([...api.files], originalFiles);
      assertEquals(api.documents.get(id), originalDocument);
      assertEquals(api.embeddings.size, 1);
    });
  });

  for (const mode of ["after", "transport-after"] as const) {
    it(`keeps a committed replacement after ${mode} metadata acknowledgement failure`, async () => {
      const api = replacementApi();
      await withMockFetch(api.fetch, async () => {
        const rag = store();
        const id = await rag.ingest("Existing", "original");
        const originalPaths = [...api.files.keys()];
        api.failMetadata(mode);
        await rag.refreshDocument!(id, "abcdefghij".repeat(501));
        assertEquals(api.embeddings.size, 501);
        assertEquals(api.files.size, 2);
        assert(originalPaths.every((path) => !api.files.has(path)));
        assertEquals([...api.documents.keys()], [id]);
      });
    });
  }

  it("preserves replacement parts when a gateway timeout precedes a delayed metadata commit", async () => {
    const api = replacementApi();
    await withMockFetch(api.fetch, async () => {
      const rag = store();
      const id = await rag.ingest("Existing", "original");
      api.failMetadata("delayed");
      await assertRejects(() => rag.refreshDocument!(id, "abcdefghij".repeat(501)));
      api.completeDelayedMetadata();
      const paths = api.documents.get(id)!.metadata.filePaths as string[];
      assertEquals(paths.length, 2);
      assert(paths.every((path) => api.files.has(path)));
      assertEquals(paths.flatMap((path) => api.files.get(path) ?? []).length, 501);
      await rag.removeDocument(id);
      assertEquals(api.files.size, 0);
      assertEquals(api.embeddings.size, 0);
      assertEquals(api.documents.size, 0);
    });
  });

  it("preserves legacy record-first removal while attempting every part after a deletion failure", async () => {
    const api = replacementApi();
    await withMockFetch(api.fetch, async () => {
      const rag = store();
      const id = await rag.ingest("Large", "abcdefghij".repeat(501));
      api.failDelete([...api.files.keys()][0]!);
      await rag.removeDocument(id);
      assertEquals(api.documents.size, 0);
      assertEquals(api.files.size, 1);
      await assertRejects(() => rag.refreshDocument!(id, "replacement"));
    });
  });

  it("rejects a refresh starting while removed document parts are still being cleaned", async () => {
    const api = replacementApi();
    await withMockFetch(api.fetch, async () => {
      const rag = store();
      const id = await rag.ingest("Existing", "original");
      const pause = api.pauseNextDeletion();
      const removing = rag.removeDocument(id);
      try {
        await pause.started;
        await assertRejects(() => rag.refreshDocument!(id, "replacement"));
      } finally {
        pause.release();
        await removing;
      }
      assertEquals(api.documents.size, 0);
      assertEquals(api.files.size, 0);
    });
  });
});
