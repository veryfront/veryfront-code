---
title: "veryfront/embedding"
description: "Embedding and RAG primitives for chunking, embedding, and similarity search."
order: 24
---

# veryfront/embedding

Embedding and RAG primitives for chunking, embedding, and similarity search.

## Examples

```ts
import { createUploadHandler, ragStore } from "veryfront/embedding";

const store = ragStore({});
export const { POST, GET, DELETE } = createUploadHandler(store);
```

## API groups

| Export                        | Use                                                                 |
| ----------------------------- | ------------------------------------------------------------------- |
| `embedding()`                 | Create an embedding facade for the configured runtime provider.     |
| `chunk()`                     | Split source text into chunks for indexing.                         |
| `similarity()`                | Compute cosine similarity between embedding vectors.                |
| `vectorStore()`               | Create an in-memory vector store for embeddings and metadata.       |
| `ragStore()`                  | Combine chunking, embedding, storage, and search for RAG workflows. |
| `createUploadHandler()`       | Create upload routes backed by a `RagStore`.                        |
| `loadUpload()`                | Load an uploaded document into the RAG ingestion flow.              |
| `useUploads()`                | React hook for upload state when building document ingestion UI.    |
| `registerEmbeddingProvider()` | Register a host-provided embedding provider.                        |
| `resolveEmbeddingModel()`     | Resolve the embedding model for the active runtime configuration.   |
| `clearEmbeddingProviders()`   | Reset registered embedding providers, primarily for tests.          |

## Types

The module exports `Embedding`, `EmbeddingConfig`, `ChunkOptions`,
`VectorStore`, `VectorStoreConfig`, `RagStore`, `RagStoreConfig`,
`RagStoreData`, `RagChunk`, `RagDocumentMeta`, `SearchOptions`,
`SearchResult`, `RagSearchOptions`, and `RagSearchResult`.
