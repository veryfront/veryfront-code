# Embedding and RAG

This page describes embedding generation, upload handling, chunking, vector
store access, and RAG store resolution.

## Responsibility

Embedding and RAG code turns source content into chunks, embeds those chunks,
stores vectors, and exposes retrieval helpers for agent and application code.

Primary source areas:

- `src/embedding/`
- `src/embedding/react/`
- `src/embedding/veryfront-cloud/`
- `src/provider/local/local-embedding-engine.ts`

## Runtime flow

1. Upload handlers and loaders read uploaded content.
2. Chunking utilities split source content into indexed text chunks.
3. Embedding resolution selects a configured embedding provider.
4. Vector store and RAG store code persists vectors and retrieves relevant
   chunks.
5. React upload hooks support browser-side upload flows.

## Boundaries

- Provider request transport belongs in [provider runtime](./04-provider-runtime.md).
- Agent prompt assembly belongs in [agent runtime](./03-agent-runtime.md).
- File upload UI belongs in guide or component docs, not this architecture page.

## Change checks

- Add tests for chunk boundaries, upload parsing, model resolution, and vector
  store behavior when changing retrieval code.
- Keep provider-specific behavior behind embedding provider adapters.
