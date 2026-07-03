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

| Name                        | Description                                                                        | Source                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `chunk`                     | Splits text into overlapping chunks for embedding.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/chunk.ts#L24)           |
| `clearEmbeddingProviders`   | Clear all registered embedding providers (for testing).                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts#L154)        |
| `createUploadHandler`       | Creates HTTP route handlers for upload, listing, and deletion.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L255) |
| `embedding`                 | Creates an embedding facade.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/embedding.ts#L27)       |
| `loadUpload`                | Extracts embedding-ready text or Markdown from upload formats.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-loader.ts#L18)   |
| `ragStore`                  | Creates a persistent RAG store with lazy embedding and similarity search.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/rag-store.ts#L174)      |
| `registerEmbeddingProvider` | Register an embedding provider factory.                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts#L23)         |
| `resolveEmbeddingModel`     | Resolve a "provider/model" string to an embedding runtime instance.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts#L110)        |
| `similarity`                | Compute cosine similarity between two numeric vectors.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runtime/runtime-bridge.ts#L949)   |
| `vectorStore`               | Creates an in-memory vector store with integrated embedding and similarity search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/vector-store.ts#L46)    |

### Types

| Name                        | Description                                                | Source                                                                                              |
| --------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `ChunkOptions`              | Options accepted by chunk.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L26)          |
| `Embedding`                 | Public API contract for embedding.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L17)          |
| `EmbeddingConfig`           | Configuration used by embedding.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L2)           |
| `RagChunk`                  | Public API contract for rag chunk.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L76)          |
| `RagDocumentMeta`           | Public API contract for rag document meta.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L66)          |
| `RagRefreshOptions`         | Options accepted when refreshing an existing rag document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L124)         |
| `RagSearchOptions`          | Options accepted by rag search.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L118)         |
| `RagSearchResult`           | Result returned from rag search.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L108)         |
| `RagStore`                  | Public API contract for rag store.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L131)         |
| `RagStoreBackend`           | Public API contract for rag store backend.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L91)          |
| `RagStoreConfig`            | Configuration used by rag store.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L94)          |
| `RagStoreData`              | Public API contract for rag store data.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L85)          |
| `SearchOptions`             | Options accepted by search.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L38)          |
| `SearchResult`              | Result returned from search.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L47)          |
| `UploadAuthorizationResult` |                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L89) |
| `UploadAuthorize`           |                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L91) |
| `UploadHandlerAuthConfig`   |                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L95) |
| `UploadHandlerConfig`       |                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L99) |
| `VectorStore`               | Public API contract for vector store.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L54)          |
| `VectorStoreConfig`         | Configuration used by vector store.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L33)          |
