---
title: "veryfront/embedding"
description: "RAG primitives for chunking, embedding, and similarity search."
order: 7
---

## Import

```ts
import {
  chunk,
  clearEmbeddingProviders,
  createUploadHandler,
  embedding,
  hasEmbeddingProvider,
  loadUpload,
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
| `clearEmbeddingProviders` | Clear embedding providers registered in the current project source scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts#L203) |
| `createUploadHandler` | Creates HTTP route handlers for upload, listing, and deletion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L503) |
| `embedding` | Creates an embedding facade. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/embedding.ts#L36) |
| `hasEmbeddingProvider` | Whether an embedding provider is available in the current scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts#L189) |
| `loadUpload` | Extracts embedding-ready text or Markdown from upload formats. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-loader.ts#L56) |
| `ragStore` | Creates a persistent RAG store with lazy embedding and similarity search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/rag-store.ts#L372) |
| `registerEmbeddingProvider` | Register an embedding provider factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts#L45) |
| `resolveEmbeddingModel` | Resolve a "provider/model" string to an embedding runtime instance. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts#L137) |
| `similarity` | Compute cosine similarity without overflowing or underflowing finite vector magnitudes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/similarity.ts#L9) |
| `vectorStore` | Creates an in-memory vector store with integrated embedding and similarity search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/vector-store.ts#L55) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChunkOptions` | Options accepted by chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L31) |
| `Embedding` | Public API contract for embedding. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L22) |
| `EmbeddingCallOptions` | Cancellation options accepted by embedding operations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L17) |
| `EmbeddingConfig` | Configuration used by embedding. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L2) |
| `EmbeddingProviderFactory` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts#L9) |
| `EmbeddingProviderRegistrationDisposer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts#L10) |
| `RagChunk` | Public API contract for rag chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L101) |
| `RagDocumentMeta` | Public API contract for rag document meta. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L80) |
| `RagEmbeddingFingerprint` | Provenance required to determine whether persisted document vectors are reusable. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L110) |
| `RagIngestMeta` | Metadata accepted when ingesting a rag document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L170) |
| `RagOperationOptions` | Cancellation accepted by RAG reads and transactional mutations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L178) |
| `RagRefreshOptions` | Options accepted when refreshing an existing rag document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L161) |
| `RagRemoveOptions` | Preconditions accepted when removing a rag document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L183) |
| `RagSearchOptions` | Options accepted by rag search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L154) |
| `RagSearchResult` | Result returned from rag search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L144) |
| `RagStore` | Public API contract for rag store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L189) |
| `RagStoreBackend` | Public API contract for rag store backend. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L126) |
| `RagStoreConfig` | Configuration used by rag store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L129) |
| `RagStoreData` | Public API contract for rag store data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L117) |
| `SearchOptions` | Options accepted by search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L45) |
| `SearchResult` | Result returned from search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L56) |
| `UploadAuthorizationResult` | Result returned by an upload-route authorizer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L104) |
| `UploadAuthorize` | Authorizes one upload-route request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L112) |
| `UploadHandlerAuthConfig` | Explicit authorization policy for upload routes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L122) |
| `UploadHandlerConfig` | Configuration for bounded, explicitly authorized upload route handlers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L127) |
| `UploadLoadOptions` | Options controlling upload extraction resource use and cancellation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-loader.ts#L14) |
| `VectorStore` | Public API contract for vector store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L64) |
| `VectorStoreConfig` | Configuration used by vector store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L40) |
