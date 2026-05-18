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

| Name | Description |
|------|-------------|
| `chunk` | Splits text into overlapping chunks for embedding. |
| `clearEmbeddingProviders` | Clear all registered embedding providers (for testing). |
| `createUploadHandler` | Creates HTTP route handlers for upload, listing, and deletion. |
| `embedding` | Creates an embedding facade. |
| `loadUpload` | Extracts plain text from various upload formats. |
| `ragStore` | Creates a persistent RAG store with lazy embedding and similarity search. |
| `registerEmbeddingProvider` | Register an embedding provider factory. |
| `resolveEmbeddingModel` | Resolve a "provider/model" string to an embedding runtime instance. |
| `similarity` |  |
| `useUploads` | useUploads hook for managing RAG upload lifecycle. |
| `vectorStore` | Creates an in-memory vector store with integrated embedding and similarity search. |

### Types

| Name | Description |
|------|-------------|
| `ChunkOptions` |  |
| `Embedding` |  |
| `EmbeddingConfig` |  |
| `RagChunk` |  |
| `RagDocumentMeta` |  |
| `RagSearchOptions` |  |
| `RagSearchResult` |  |
| `RagStore` |  |
| `RagStoreBackend` |  |
| `RagStoreConfig` |  |
| `RagStoreData` |  |
| `SearchOptions` |  |
| `SearchResult` |  |
| `UseUploadsOptions` |  |
| `UseUploadsResult` |  |
| `VectorStore` |  |
| `VectorStoreConfig` |  |
