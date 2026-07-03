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

| Name                        | Description                                                                        | Source                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `chunk`                     | Splits text into overlapping chunks for embedding.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/chunk.ts#L23)             |
| `clearEmbeddingProviders`   | Clear all registered embedding providers (for testing).                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts#L153)          |
| `createUploadHandler`       | Creates HTTP route handlers for upload, listing, and deletion.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L239)   |
| `embedding`                 | Creates an embedding facade.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/embedding.ts#L26)         |
| `loadUpload`                | Extracts embedding-ready text or Markdown from upload formats.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-loader.ts#L18)     |
| `ragStore`                  | Creates a persistent RAG store with lazy embedding and similarity search.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/rag-store.ts#L174)        |
| `registerEmbeddingProvider` | Register an embedding provider factory.                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts#L22)           |
| `resolveEmbeddingModel`     | Resolve a "provider/model" string to an embedding runtime instance.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts#L109)          |
| `similarity`                | Compute cosine similarity between two numeric vectors.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runtime/runtime-bridge.ts#L807)     |
| `useUploads`                | useUploads hook for managing RAG upload lifecycle.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/react/use-uploads.ts#L40) |
| `vectorStore`               | Creates an in-memory vector store with integrated embedding and similarity search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/vector-store.ts#L45)      |

### Types

| Name                        | Description                                                | Source                                                                                                 |
| --------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `ChunkOptions`              | Options accepted by chunk.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L25)             |
| `Embedding`                 | Public API contract for embedding.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L16)             |
| `EmbeddingConfig`           | Configuration used by embedding.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L1)              |
| `RagChunk`                  | Public API contract for rag chunk.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L75)             |
| `RagDocumentMeta`           | Public API contract for rag document meta.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L65)             |
| `RagRefreshOptions`         | Options accepted when refreshing an existing rag document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L123)            |
| `RagSearchOptions`          | Options accepted by rag search.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L117)            |
| `RagSearchResult`           | Result returned from rag search.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L107)            |
| `RagStore`                  | Public API contract for rag store.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L130)            |
| `RagStoreBackend`           | Public API contract for rag store backend.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L90)             |
| `RagStoreConfig`            | Configuration used by rag store.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L93)             |
| `RagStoreData`              | Public API contract for rag store data.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L84)             |
| `SearchOptions`             | Options accepted by search.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L37)             |
| `SearchResult`              | Result returned from search.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L46)             |
| `UploadAuthorizationResult` |                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L88)    |
| `UploadAuthorize`           |                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L90)    |
| `UploadHandlerAuthConfig`   |                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L94)    |
| `UploadHandlerConfig`       |                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L98)    |
| `UseUploadsOptions`         | Options accepted by use uploads.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/react/use-uploads.ts#L12) |
| `UseUploadsResult`          | Result returned from use uploads.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/react/use-uploads.ts#L18) |
| `VectorStore`               | Public API contract for vector store.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L53)             |
| `VectorStoreConfig`         | Configuration used by vector store.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L32)             |
