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
export const { POST, GET, DELETE } = createUploadHandler(store);
```

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `chunk` | Splits text into overlapping chunks for embedding. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/chunk.ts#L24) |
| `clearEmbeddingProviders` | Clear all registered embedding providers (for testing). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts#L154) |
| `createUploadHandler` | Creates HTTP route handlers for upload, listing, and deletion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L165) |
| `embedding` | Creates an embedding facade. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/embedding.ts#L27) |
| `loadUpload` | Extracts plain text from various upload formats. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-loader.ts#L17) |
| `ragStore` | Creates a persistent RAG store with lazy embedding and similarity search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/rag-store.ts#L72) |
| `registerEmbeddingProvider` | Register an embedding provider factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts#L23) |
| `resolveEmbeddingModel` | Resolve a "provider/model" string to an embedding runtime instance. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts#L110) |
| `similarity` | Compute cosine similarity between two numeric vectors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runtime/runtime-bridge.ts#L592) |
| `useUploads` | useUploads hook for managing RAG upload lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/react/use-uploads.ts#L37) |
| `vectorStore` | Creates an in-memory vector store with integrated embedding and similarity search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/vector-store.ts#L46) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChunkOptions` | Options accepted by chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L26) |
| `Embedding` | Public API contract for embedding. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L17) |
| `EmbeddingConfig` | Configuration used by embedding. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L2) |
| `RagChunk` | Public API contract for rag chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L76) |
| `RagDocumentMeta` | Public API contract for rag document meta. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L66) |
| `RagSearchOptions` | Options accepted by rag search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L118) |
| `RagSearchResult` | Result returned from rag search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L108) |
| `RagStore` | Public API contract for rag store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L124) |
| `RagStoreBackend` | Public API contract for rag store backend. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L91) |
| `RagStoreConfig` | Configuration used by rag store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L94) |
| `RagStoreData` | Public API contract for rag store data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L85) |
| `SearchOptions` | Options accepted by search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L38) |
| `SearchResult` | Result returned from search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L47) |
| `UseUploadsOptions` | Options accepted by use uploads. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/react/use-uploads.ts#L13) |
| `UseUploadsResult` | Result returned from use uploads. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/react/use-uploads.ts#L19) |
| `VectorStore` | Public API contract for vector store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L54) |
| `VectorStoreConfig` | Configuration used by vector store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L33) |
