import { ragStore } from "./rag-store.ts";
import type {
  UploadSearchOptions,
  UploadSearchResult,
  UploadStore,
  UploadStoreConfig,
} from "./types.ts";

/**
 * Backwards-compatible alias for the legacy upload store API.
 *
 * The underlying implementation is `ragStore()`. This wrapper preserves the
 * old method names and result shapes while keeping the new RAG methods
 * available for callers that already migrated.
 */
export function uploadStore(config: UploadStoreConfig): UploadStore {
  const store = ragStore(config);

  return {
    ingest: store.ingest.bind(store),
    async search(query: string, options?: UploadSearchOptions): Promise<UploadSearchResult[]> {
      const results = await store.search(query, options);
      return results.map((result) => ({
        ...result,
        uploadId: result.documentId,
      }));
    },
    listDocuments: store.listDocuments.bind(store),
    async listUploads() {
      return await store.listDocuments();
    },
    removeDocument: store.removeDocument.bind(store),
    async removeUpload(id: string) {
      await store.removeDocument(id);
    },
    indexContentDir: store.indexContentDir.bind(store),
  };
}
