# Provider runtime

This page describes provider and model resolution. It does not cover agent
message preparation, embedding storage, or workflow execution.

## Responsibility

The provider runtime resolves model providers, builds provider requests, streams
provider responses, and exposes local or Veryfront Cloud provider adapters.

Primary source areas:

- `src/provider/`
- `src/provider/runtime-loader/`
- `src/provider/local/`
- `src/provider/veryfront-cloud/`
- `src/agent/runtime/model-resolution.ts`

## Runtime flow

1. Agent or request options provide model and provider hints.
2. Model resolution applies defaults, explicit overrides, and supported provider
   capabilities.
3. Runtime loader helpers build request init, endpoint URLs, SSE parsers, usage
   records, embedding responses, and tool input status.
4. Provider adapters send requests to local engines or Veryfront Cloud provider
   endpoints.
5. Agent runtime code consumes the provider stream through provider-neutral
   runtime events.

## Boundaries

- Agent runtime owns conversation messages and tool inventory.
- Provider runtime owns provider request and response translation.
- Embedding model resolution belongs in [embedding and RAG](./06-embedding-rag.md).

## Change checks

- Preserve provider-neutral runtime contracts when changing a provider adapter.
- Add tests for model defaults, endpoint construction, SSE parsing, and usage
  accounting when changing provider request code.
- Keep secret values out of logs, thrown errors, and public docs.
