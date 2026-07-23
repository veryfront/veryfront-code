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
| `chunk` | Splits text into overlapping chunks for embedding. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/chunk.ts#L45) |
| `clearEmbeddingProviders` | Clear all registered embedding providers (for testing). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts#L193) |
| `createUploadHandler` | Creates HTTP route handlers for upload, listing, and deletion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L377) |
| `embedding` | Creates an embedding facade. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/embedding.ts#L74) |
| `loadUpload` | Extracts embedding-ready text or Markdown from upload formats. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-loader.ts#L33) |
| `ragStore` | Creates a persistent RAG store with lazy embedding and similarity search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/rag-store.ts#L269) |
| `registerEmbeddingProvider` | Register an embedding provider factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts#L26) |
| `resolveEmbeddingModel` | Resolve a "provider/model" string to an embedding runtime instance. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts#L137) |
| `similarity` | Compute cosine similarity between two numeric vectors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runtime/runtime-bridge.ts#L984) |
| `vectorStore` | Creates an in-memory vector store with integrated embedding and similarity search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/vector-store.ts#L66) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChunkOptions` | Options accepted by {@link chunk}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L34) |
| `Embedding` | Embeds query and document text with one configured model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L24) |
| `EmbeddingCallOptions` | Options shared by individual embedding operations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L18) |
| `EmbeddingConfig` | Configuration used by {@link embedding}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L2) |
| `EmbeddingProviderFactory` | Factory used to construct an embedding runtime for a provider model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts#L13) |
| `EmbeddingRuntime` | Public API contract for an embedding runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L46) |
| `RagChunk` | One searchable chunk belonging to a RAG document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L110) |
| `RagDocumentMeta` | Metadata describing one RAG document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L94) |
| `RagIngestMetadata` | Metadata accepted when ingesting a RAG document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L199) |
| `RagRefreshOptions` | Metadata changes accepted when refreshing an existing RAG document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L189) |
| `RagSearchOptions` | Options accepted by RAG search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L179) |
| `RagSearchResult` | Result returned from RAG search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L163) |
| `RagStore` | Persistent RAG-store contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L207) |
| `RagStoreBackend` | Supported RAG persistence backends. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L136) |
| `RagStoreConfig` | Configuration used by {@link ragStore}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L139) |
| `RagStoreData` | Serialized local RAG-store data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L124) |
| `RuntimeMetadata` | Metadata exposed by a model or embedding runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L2) |
| `SearchOptions` | Options accepted by vector-store search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L52) |
| `SearchResult` | Result returned from vector-store search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L68) |
| `UploadAuthorizationResult` | Result accepted from an upload authorization callback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L103) |
| `UploadAuthorize` | Callback that authorizes one upload-route request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L106) |
| `UploadHandlerAuthConfig` | Authentication policy for generated upload handlers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L111) |
| `UploadHandlerConfig` | Configuration used by {@link createUploadHandler}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L116) |
| `UploadHandlers` | HTTP handlers returned by {@link createUploadHandler}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L130) |
| `UploadLoadOptions` | Options accepted by {@link loadUpload}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-loader.ts#L17) |
| `UploadRouteContext` | Route context accepted by the generated delete handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L124) |
| `VectorStore` | In-memory vector store contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L78) |
| `VectorStoreConfig` | Configuration used by {@link vectorStore}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L44) |
