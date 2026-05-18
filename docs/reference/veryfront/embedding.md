---
title: "veryfront/embedding"
description: "Embedding — RAG primitives for chunking, embedding, and similarity search. Provides a facade over the framework's current embedding runtime and LangChain text splitting behind veryfront's own API."
order: 24
---

# veryfront/embedding

Embedding — RAG primitives for chunking, embedding, and similarity search. Provides a facade over the framework's current embedding runtime and LangChain text splitting behind veryfront's own API.

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
| `chunk` | Splits text into overlapping chunks for embedding. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/chunk.ts#L23) |
| `clearEmbeddingProviders` | Clear all registered embedding providers (for testing). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts#L153) |
| `createUploadHandler` | Creates HTTP route handlers for upload, listing, and deletion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-handler.ts#L163) |
| `embedding` | Creates an embedding facade. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/embedding.ts#L26) |
| `loadUpload` | Extracts plain text from various upload formats. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/upload-loader.ts#L16) |
| `ragStore` | Creates a persistent RAG store with lazy embedding and similarity search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/rag-store.ts#L71) |
| `registerEmbeddingProvider` | Register an embedding provider factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts#L22) |
| `resolveEmbeddingModel` | Resolve a "provider/model" string to an embedding runtime instance. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/resolve.ts#L109) |
| `similarity` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runtime/runtime-bridge.ts#L591) |
| `useUploads` | useUploads hook for managing RAG upload lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/react/use-uploads.ts#L34) |
| `vectorStore` | Creates an in-memory vector store with integrated embedding and similarity search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/vector-store.ts#L45) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChunkOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L22) |
| `Embedding` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L14) |
| `EmbeddingConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts) |
| `RagChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L66) |
| `RagDocumentMeta` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L57) |
| `RagSearchOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L103) |
| `RagSearchResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L94) |
| `RagStore` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L108) |
| `RagStoreBackend` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L79) |
| `RagStoreConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L81) |
| `RagStoreData` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L74) |
| `SearchOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L32) |
| `SearchResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L40) |
| `UseUploadsOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/react/use-uploads.ts#L11) |
| `UseUploadsResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/react/use-uploads.ts#L16) |
| `VectorStore` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L46) |
| `VectorStoreConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L28) |

## Related

Architecture:

- [07-provider-runtime](../../architecture/07-provider-runtime.md): Embedding shares provider model resolution
