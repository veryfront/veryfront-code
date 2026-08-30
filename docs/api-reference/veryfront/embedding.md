---
title: "veryfront/embedding"
description: "RAG primitives for chunking, embedding, and similarity search."
order: 6
---

## Import

```ts
import {
  chunk,
  clearEmbeddingProviders,
  createUploadHandler,
  embedding,
  loadUpload,
  ragStore,
} from "veryfront/embedding";
```

## Examples

```ts
import { createUploadHandler, ragStore } from "veryfront/embedding";

const store = ragStore({});
export const { POST, GET, DELETE } = createUploadHandler(store, {
  auth: { type: "none", allowUnauthenticated: true },
});
```

## Exports

### Functions

| Name                        | Description                                                                        | Source                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `chunk`                     | Splits text into overlapping chunks for embedding.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/chunk.ts)          |
| `clearEmbeddingProviders`   | Clear all registered embedding providers (for testing).                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts)        |
| `createUploadHandler`       | Creates HTTP route handlers for upload, listing, and deletion.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts) |
| `embedding`                 | Creates an embedding facade.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/embedding.ts)      |
| `loadUpload`                | Extracts embedding-ready text or Markdown from upload formats.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-loader.ts)  |
| `ragStore`                  | Creates a persistent RAG store with lazy embedding and similarity search.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/rag-store.ts)      |
| `registerEmbeddingProvider` | Register an embedding provider factory.                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts)        |
| `resolveEmbeddingModel`     | Resolve a "provider/model" string to an embedding runtime instance.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts)        |
| `similarity`                | Compute cosine similarity between two numeric vectors.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runtime/runtime-bridge.ts)   |
| `vectorStore`               | Creates an in-memory vector store with integrated embedding and similarity search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/vector-store.ts)   |

### Types

| Name                        | Description                                                | Source                                                                                          |
| --------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `ChunkOptions`              | Options accepted by chunk.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts)          |
| `Embedding`                 | Public API contract for embedding.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts)          |
| `EmbeddingConfig`           | Configuration used by embedding.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts)          |
| `RagChunk`                  | Public API contract for rag chunk.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts)          |
| `RagDocumentMeta`           | Public API contract for rag document meta.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts)          |
| `RagRefreshOptions`         | Options accepted when refreshing an existing rag document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts)          |
| `RagSearchOptions`          | Options accepted by rag search.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts)          |
| `RagSearchResult`           | Result returned from rag search.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts)          |
| `RagStore`                  | Public API contract for rag store.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts)          |
| `RagStoreBackend`           | Public API contract for rag store backend.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts)          |
| `RagStoreConfig`            | Configuration used by rag store.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts)          |
| `RagStoreData`              | Public API contract for rag store data.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts)          |
| `SearchOptions`             | Options accepted by search.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts)          |
| `SearchResult`              | Result returned from search.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts)          |
| `UploadAuthorizationResult` |                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts) |
| `UploadAuthorize`           |                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts) |
| `UploadHandlerAuthConfig`   |                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts) |
| `UploadHandlerConfig`       |                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts) |
| `VectorStore`               | Public API contract for vector store.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts)          |
| `VectorStoreConfig`         | Configuration used by vector store.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts)          |
