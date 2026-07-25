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
import { ragStore, createUploadHandler } from "veryfront/embedding";

const store = ragStore({});
export const { POST, GET, DELETE } = createUploadHandler(store, {
  auth: { type: "none", allowUnauthenticated: true },
});
```

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `chunk` | Splits text into overlapping chunks for embedding. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/chunk.ts#L36) |
| `clearEmbeddingProviders` | Clear embedding providers registered in the current project source scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts#L180) |
| `createUploadHandler` | Creates HTTP route handlers for upload, listing, and deletion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L256) |
| `embedding` | Creates an embedding facade. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/embedding.ts#L36) |
| `loadUpload` | Extracts embedding-ready text or Markdown from upload formats. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-loader.ts#L19) |
| `ragStore` | Creates a persistent RAG store with lazy embedding and similarity search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/rag-store.ts#L362) |
| `registerEmbeddingProvider` | Register an embedding provider factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts#L30) |
| `resolveEmbeddingModel` | Resolve a "provider/model" string to an embedding runtime instance. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts#L125) |
| `similarity` | Compute cosine similarity between two numeric vectors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runtime/runtime-bridge.ts#L2153) |
| `vectorStore` | Creates an in-memory vector store with integrated embedding and similarity search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/vector-store.ts#L55) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChunkOptions` | Options accepted by chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L31) |
| `Embedding` | Public API contract for embedding. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L22) |
| `EmbeddingCallOptions` | Cancellation options accepted by embedding operations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L17) |
| `EmbeddingConfig` | Configuration used by embedding. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L2) |
| `RagChunk` | Public API contract for rag chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L97) |
| `RagDocumentMeta` | Public API contract for rag document meta. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L80) |
| `RagEmbeddingFingerprint` | Provenance required to determine whether persisted document vectors are reusable. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L106) |
| `RagRefreshOptions` | Options accepted when refreshing an existing rag document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L157) |
| `RagSearchOptions` | Options accepted by rag search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L150) |
| `RagSearchResult` | Result returned from rag search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L140) |
| `RagStore` | Public API contract for rag store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L164) |
| `RagStoreBackend` | Public API contract for rag store backend. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L122) |
| `RagStoreConfig` | Configuration used by rag store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L125) |
| `RagStoreData` | Public API contract for rag store data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L113) |
| `SearchOptions` | Options accepted by search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L45) |
| `SearchResult` | Result returned from search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L56) |
| `UploadAuthorizationResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L90) |
| `UploadAuthorize` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L92) |
| `UploadHandlerAuthConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L96) |
| `UploadHandlerConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L100) |
| `VectorStore` | Public API contract for vector store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L64) |
| `VectorStoreConfig` | Configuration used by vector store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L40) |
