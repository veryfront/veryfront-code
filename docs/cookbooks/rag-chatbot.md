---
title: "Building a RAG Chatbot"
category: "cookbooks"
level: "advanced"
keywords: ["rag", "vector-database", "embeddings", "pdf", "chat"]
ai_summary: "Recipe for building a Retrieval-Augmented Generation (RAG) chatbot that can answer questions from PDF documents."
related: ["reference/ai/tools", "reference/ai/agent"]
version: "0.1.0"
last_updated: "2025-11-22"
---

# Recipe: RAG Chatbot with PDF Ingestion

This cookbook demonstrates how to build a **Retrieval-Augmented Generation (RAG)** system using Veryfront. The agent will have access to a knowledge base created from PDF documents.

## Prerequisites

- OpenAI API Key (for embeddings and chat)
- A Vector Database (we'll use a simple in-memory store for this demo, but it swaps easily with Pinecone/Supabase)

## 1. The Vector Store (Memory)

First, let's create a simple vector store utility. In production, replace this with a real database.

```typescript
// lib/vector-store.ts
import { openai } from 'veryfront/ai';

interface DocumentChunk {
  id: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

const store: DocumentChunk[] = [];

export const vectorStore = {
  async add(content: string, metadata = {}) {
    // Generate embedding
    const { embedding } = await openai.embeddings.create({
      input: content,
      model: 'text-embedding-3-small'
    });

    store.push({
      id: crypto.randomUUID(),
      content,
      embedding,
      metadata,
    });
  },

  async search(query: string, limit = 3) {
    const { embedding: queryEmbedding } = await openai.embeddings.create({
      input: query,
      model: 'text-embedding-3-small'
    });

    // Cosine similarity search (simplified)
    return store
      .map(doc => ({
        ...doc,
        similarity: cosineSimilarity(queryEmbedding, doc.embedding)
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }
};

function cosineSimilarity(a: number[], b: number[]) {
  return a.reduce((sum, v, i) => sum + v * b[i], 0);
}
```

## 2. The Retrieval Tool

Now, expose this vector store as a tool for the agent.

```typescript
// ai/tools/knowledge-base.ts
import { tool } from 'veryfront/ai';
import { z } from 'zod';
import { vectorStore } from '../../lib/vector-store';

export default tool({
  description: 'Search the internal knowledge base for company policies and documents.',
  inputSchema: z.object({
    query: z.string().describe('The topic to search for'),
  }),
  execute: async ({ query }) => {
    const results = await vectorStore.search(query);
    
    if (results.length === 0) {
      return "No relevant documents found.";
    }

    return results
      .map(r => `[Content]: ${r.content}\n[Source]: ${JSON.stringify(r.metadata)}`)
      .join('\n---\n');
  },
});
```

## 3. The Agent

Create an agent that uses this tool.

```typescript
// ai/agents/support.ts
import { agent } from 'veryfront/ai';

export default agent({
  model: 'openai/gpt-4-turbo',
  system: `You are a helpful support assistant. 
  ALWAYS check the knowledge base before answering questions about company policy.
  If you find information, cite the source.`,
  tools: {
    // Auto-discovered from ai/tools/knowledge-base.ts
    knowledgeBase: true, 
  },
});
```

## 4. Ingestion Script (CLI)

Create a script to load your PDFs.

```typescript
// scripts/ingest.ts
import { vectorStore } from '../lib/vector-store';

// Mock PDF content for demo
const documents = [
  "The company remote work policy allows 3 days WFH per week.",
  "Expense reports must be submitted by the 5th of each month.",
  "The wifi password is 'SecurePass123!'",
];

console.log("Ingesting documents...");
for (const doc of documents) {
  await vectorStore.add(doc, { source: "handbook.pdf" });
}
console.log("Done!");
```

## 5. Usage

Run ingestion:
```bash
deno run --allow-net --allow-env scripts/ingest.ts
```

Chat with the agent:
```typescript
// In your app
const response = await agents.support.generate("Can I work from home on Fridays?");
// Output: "Yes, the remote work policy allows 3 days WFH per week (Source: handbook.pdf)."
```
