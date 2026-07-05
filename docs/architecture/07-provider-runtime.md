# Provider runtime

This page describes provider and model resolution, provider request transport,
and the embedding pipeline (chunking, embedding model resolution, vector store
access, and RAG store helpers). It does not cover agent message preparation,
workflow execution, or browser upload UI.

## Responsibility

The provider runtime resolves model providers, builds provider requests, streams
provider responses, and exposes local or Veryfront Cloud provider adapters.
Embedding code reuses the same provider model resolution to turn source content
into chunks, embed those chunks, store vectors, and expose retrieval helpers
for agent and application code.

Primary source areas:

- [`src/provider/`](../../src/provider/)
- [`src/provider/runtime-loader/`](../../src/provider/runtime-loader/)
- [`src/provider/local/`](../../src/provider/local/)
- [`src/provider/veryfront-cloud/`](../../src/provider/veryfront-cloud/)
- [`src/agent/runtime/model-resolution.ts`](../../src/agent/runtime/model-resolution.ts)
- [`src/embedding/`](../../src/embedding/)
- [`src/embedding/veryfront-cloud/`](../../src/embedding/veryfront-cloud/)
- [`src/embedding/model-resolution.ts`](../../src/embedding/model-resolution.ts)
- [`src/provider/local/local-embedding-engine.ts`](../../src/provider/local/local-embedding-engine.ts)

## Runtime flow

1. Agent or request options provide model and provider hints.
2. Model resolution applies defaults, explicit overrides, and supported provider
   capabilities.
3. Runtime loader helpers build request init, endpoint URLs, SSE parsers, usage
   records, embedding responses, and tool input status.
4. Provider adapters send requests to local engines or Veryfront Cloud provider
   endpoints.
5. The agent runtime consumes the provider stream through provider-neutral
   runtime events.

## Embedding and RAG

1. Upload handlers and loaders read uploaded content.
2. Chunking utilities split source content into indexed text chunks.
3. Embedding resolution selects a configured embedding provider.
4. Vector store and RAG store code persists vectors and retrieves relevant
   chunks.
5. React upload hooks support browser-side upload flows.

## Boundaries

- The agent runtime owns conversation messages and tool inventory; see
  [agent runtime](./05-agent-runtime.md).
- The provider runtime owns provider request and response translation.
- Agent prompt assembly and retrieval orchestration belong in
  [agent runtime](./05-agent-runtime.md), not in embedding helpers.
- File upload UI belongs in guide or component docs, not this architecture
  page.

## Change checks

- Preserve provider-neutral runtime contracts when changing a provider adapter.
- Add tests for model defaults, endpoint construction, SSE parsing, and usage
  accounting when changing provider request code.
- Add tests for chunk boundaries, upload parsing, model resolution, and vector
  store behavior when changing retrieval code.
- Keep provider-specific behavior behind embedding provider adapters.
- Keep secret values out of logs, thrown errors, and public docs.

## Related guides

- [Providers](../guides/providers.md)

## Related reference

- [`veryfront/provider`](../api-reference/veryfront/provider.md)
- [`veryfront/embedding`](../api-reference/veryfront/embedding.md)
