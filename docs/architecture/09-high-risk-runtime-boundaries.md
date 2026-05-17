# High-risk runtime boundaries

This page lists runtime areas where small changes can affect multiple public
surfaces. Use it as a change checklist, not as a complete architecture guide.

Each section separates current facts from change guidance. When a boundary
depends on a service outside this repository, keep that dependency explicit.

## Provider runtime flow

Current files:

- `src/provider/runtime-loader.ts`
- `src/provider/runtime-loader/provider-request-init.ts`
- `src/provider/runtime-loader/provider-http.ts`
- `src/provider/runtime-loader/provider-sse.ts`
- `src/provider/runtime-loader/provider-usage.ts`
- `src/provider/runtime-loader/provider-embedding-responses.ts`
- `src/provider/veryfront-cloud/provider.ts`
- `src/provider/local/local-provider.test.ts`

Current facts:

- Request construction, HTTP transport, SSE parsing, usage extraction, and
  embedding parsing are separate modules under
  `src/provider/runtime-loader/`.
- The provider runtime serves hosted provider adapters, Veryfront Cloud routing,
  local runtime adapters, and agent streaming paths.
- Provider output feeds agent runtime code, so stream shape changes are public
  behavior changes even when the edit is in `src/provider/`.

Before changing this, run or add:

- `deno test --no-check --allow-all src/provider/runtime-loader.test.ts`
- `deno test --no-check --allow-all src/provider/runtime-loader/provider-request-init.test.ts`
- `deno test --no-check --allow-all src/provider/veryfront-cloud/provider.test.ts`
- Add fixture coverage when changing provider-specific request or response
  normalization.

## API module loading

Current files:

- `src/modules/react-loader/ssr-module-loader/loader.ts`
- `src/modules/react-loader/ssr-module-loader/ssr-cache-manager.ts`
- `src/modules/react-loader/ssr-module-loader/http-bundle-helpers.ts`
- `src/transforms/import-rewriter/parse-cache.ts`
- `tests/integration/build/bundler/utils/import-utils.test.ts`
- `tests/e2e/regressions/2026-01-31-missing-http-bundles.test.ts`

Current facts:

- Module loading crosses server request handling, SSR transforms, import
  rewriting, cache lookup, HTTP bundle recovery, and runtime compatibility.
- Redis/API cache content must not expose machine-specific local paths.
- External import rewriting and bundle recovery affect both development and
  deployed runtimes.

Before changing this, run or add:

- `deno test --no-check --allow-all src/modules/react-loader/ssr-module-loader/`
- `deno test --no-check --allow-all src/transforms/import-rewriter/`
- `deno test --no-check --allow-all tests/integration/build/bundler/utils/import-utils.test.ts`
- Add a regression test when changing cache key shape, bundle URL rewriting, or
  fallback loading behavior.

## AG-UI and hosted UI chunk mapping

Current files:

- `src/agent/ag-ui/browser-chunk-encoder.ts`
- `src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts`
- `src/agent/ag-ui/chunk-encoder-bridge.ts`
- `src/agent/ag-ui/runtime-event-encoder.ts`
- `src/agent/hosted/response-stream.ts`
- `src/agent/hosted/stream-finalization.ts`
- `src/agent/conversation/run-chunk-mirror.ts`
- `docs/reference/agent-runtime-ag-ui-contract.md`

Current facts:

- AG-UI event encoding, browser chunk encoding, hosted response streams, and
  durable run mirrors are related but not identical contracts.
- Browser-facing chunk shape is public behavior. Hosted runtime chunk shape is
  also consumed by control-plane and durable mirror paths.
- Compatibility helpers must not become the source of truth for the canonical
  AG-UI package contract.

Before changing this, run or add:

- `deno test --no-check --allow-all src/agent/ag-ui/`
- `deno test --no-check --allow-all src/agent/hosted/response-stream.test.ts`
- `deno test --no-check --allow-all src/agent/hosted/stream-finalization.test.ts`
- `deno test --no-check --allow-all src/agent/conversation/run-chunk-mirror.test.ts`
- Update `docs/reference/agent-runtime-ag-ui-contract.md` when the canonical
  event contract changes.

## Render, SSR, and RSC pipeline

Current files:

- `src/server/handlers/request/`
- `src/rendering/index.ts`
- `src/rendering/rsc/actions/index.ts`
- `src/modules/react-loader/`
- `src/html/index.ts`
- `src/build/production-build/index.ts`
- `docs/architecture/02-request-pipeline.md`

Current facts:

- Server request handling, rendering, RSC actions, module loading, HTML output,
  cache behavior, and production build output form one runtime cluster.
- Some code paths are shared by development, production server mode, and
  compiled binary tests.
- Generated HTML and RSC payload behavior can be user-visible even when no
  public TypeScript export changes.

Before changing this, run or add:

- `deno test --no-check --allow-all src/server/handlers/request/`
- `deno test --no-check --allow-all src/rendering/`
- `deno test --no-check --allow-all src/modules/react-loader/`
- Run a production build or focused integration test when changing build output,
  server bootstrap, or RSC payload behavior.

## AgentRuntime and child runs

Current files:

- `src/agent/runtime/chat-stream-handler.ts`
- `src/agent/runtime/model-tool-converter.ts`
- `src/agent/runtime/provider-tool-compat.ts`
- `src/agent/hosted/child-fork-stream-execution.ts`
- `src/agent/hosted/child-pending-tool-lifecycle.ts`
- `src/agent/hosted/child-tool-input.ts`
- `src/agent/conversation/run-stream-mirror.ts`
- `src/agent/conversation/run-mirror.ts`
- `src/agent/conversation/run-event-normalization.ts`

Current facts:

- AgentRuntime coordinates model input preparation, provider tool conversion,
  streamed output, tool lifecycle events, child-run execution, and durable run
  mirroring.
- Child-run tool lifecycle changes can affect provider-native tools, remote
  tools, AG-UI events, and persisted conversation events.
- Durable mirror behavior depends on event ordering and retry semantics. Treat
  ordering changes as compatibility-sensitive.

Before changing this, run or add:

- `deno test --no-check --allow-all src/agent/runtime/`
- `deno test --no-check --allow-all src/agent/hosted/child-fork-stream-execution.test.ts`
- `deno test --no-check --allow-all src/agent/hosted/child-pending-tool-lifecycle.test.ts`
- `deno test --no-check --allow-all src/agent/hosted/child-tool-input.test.ts`
- `deno test --no-check --allow-all src/agent/conversation/run-stream-mirror.test.ts`
- Add contract tests before changing tool call IDs, tool input error shape,
  child-run lineage fields, or stream terminal-event handling.

## Change standard

Use the narrowest relevant command first. Broaden verification when the change
touches a shared contract, public export, generated reference, browser stream,
control-plane payload, or durable runtime state.

For refactors, keep compatibility evidence in the PR:

- list the boundary being changed,
- list tests added or run,
- call out any public contract or generated docs update,
- and state any external service dependency that this repository cannot verify.
