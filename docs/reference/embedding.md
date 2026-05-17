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
