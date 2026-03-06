# NLSpec: src/provider/

## Purpose

The provider module is the AI model resolution layer for VeryFront. It maps `"provider/model"` strings (e.g. `"openai/gpt-4o"`) to AI SDK `LanguageModel` instances, auto-initializes cloud providers (OpenAI, Anthropic, Google) from environment variables, and provides a zero-configuration local model fallback using `@huggingface/transformers` with ONNX Runtime. The module is project-scoped via `ProjectScopedRegistryManager`, allowing multi-tenant isolation of provider registrations while sharing auto-initialized providers across all projects. It also includes an AI SDK adapter layer for wrapping models/tools, Zod validation schemas for provider configuration and completion requests/responses, and a local inference subsystem with model catalog, streaming engine, and embedding support.

## Public API

### Exports (`src/provider/index.ts` via `#veryfront/provider`)

| Export | Type | Description |
|--------|------|-------------|
| `registerModelProvider` | `(name: string, factory: ModelProviderFactory) => void` | Register a custom AI SDK model provider factory for the current project |
| `resolveModel` | `(modelString: string) => LanguageModel` | Parse `"provider/model"` and return a resolved `LanguageModel` instance |
| `hasModelProvider` | `(name: string) => boolean` | Check if a provider name is registered (project-scoped or shared) |
| `getRegisteredModelProviders` | `() => string[]` | List all registered provider names for the current project |
| `findAvailableCloudModel` | `() => string \| null` | Find the first cloud provider with a valid API key; returns `"provider/model"` or `null` |
| `ensureModelReady` | `(model: LanguageModel) => Promise<void>` | Eagerly verify local model runtime availability (no-op for non-local models) |
| `clearModelProviders` | `() => void` | Reset all providers and auto-init state (testing only) |
| `ModelProviderFactory` | type | `(modelId: string) => LanguageModel` |

### Exports (`src/provider/adapters/index.ts`)

| Export | Type | Description |
|--------|------|-------------|
| `aiSDKModel` / `useAISDK` | `<Model>(model: Model) => AISDKModelWrapper<Model>` | Wrap a model instance with an AI SDK brand marker |
| `isAISDKModel` | `(value: unknown) => value is AISDKModelWrapper` | Type guard for branded AI SDK model wrappers |
| `toAISDKTool` | `(tool: Tool) => { type, function }` | Convert a VeryFront `Tool` to AI SDK function-call format |
| `toAISDKTools` | `(tools: Record<string, Tool>) => Record<string, ...>` | Batch convert tools to AI SDK format with `execute` attached |
| `AISDKModelWrapper` | type/interface | Branded wrapper: `{ __type: "ai-sdk-model", model }` |
| `AI_SDK_ADAPTER_VERSION` | `"1.0.0"` | Adapter version constant |
| `AI_SDK_SUPPORTED_VERSION` | `"3.x"` | Supported AI SDK version constant |

### Exports (`src/provider/schemas/index.ts`)

| Export | Type | Description |
|--------|------|-------------|
| `ProviderConfigSchema` | Zod object | Base provider config: optional `apiKey`, `baseURL`, `organizationId`, `options` |
| `OpenAIConfigSchema` | Zod object | Extends base with required `apiKey` |
| `AnthropicConfigSchema` | Zod object | Extends base with required `apiKey` |
| `GoogleConfigSchema` | Zod object | Extends base with required `apiKey` |
| `ProvidersConfigSchema` | Zod object | Container: optional `default`, `openai`, `anthropic`, `google` |
| `CompletionRequestSchema` | Zod object | Validates completion request payloads |
| `CompletionResponseSchema` | Zod object | Validates completion response payloads |
| `ProviderConfig`, `OpenAIConfig`, `AnthropicConfig`, `GoogleConfig`, `ProvidersConfig`, `CompletionRequest`, `CompletionResponse` | inferred types | TypeScript types inferred from Zod schemas |

### Exports (`src/provider/local/index.ts`)

| Export | Type | Description |
|--------|------|-------------|
| `createLocalModel` | `(modelId?: string) => LanguageModel` | Create an AI SDK LanguageModelV2-compatible local model |
| `createLocalEmbeddingModel` | `(modelId?: string) => EmbeddingModel` | Create an AI SDK EmbeddingModelV2-compatible local model |
| `isLocalAIDisabled` | `() => boolean` | Check `VERYFRONT_DISABLE_LOCAL_AI=1` env var |
| `generate` | `(modelId, messages, options?) => Promise<string>` | Full text generation (non-streaming) |
| `generateStream` | `(modelId, messages, options?) => AsyncGenerator<string>` | Streaming text generation |
| `embedTexts` | `(modelId, texts) => Promise<number[][]>` | Generate embedding vectors for text array |
| `getTransformers` | `() => Promise<TransformersModule>` | Lazily import `@huggingface/transformers` |
| `preloadModel` | `(modelId: string) => Promise<void>` | Warm up a model pipeline |
| `isModelLoaded` | `(modelId: string) => boolean` | Check if a model pipeline is cached |
| `verifyLocalRuntime` | `(modelId?: string) => Promise<void>` | Eagerly verify ONNX runtime availability |
| `DEFAULT_LOCAL_MODEL` | `"smollm2-135m"` | Default language model ID |
| `DEFAULT_LOCAL_EMBEDDING_MODEL` | `"all-MiniLM-L6-v2"` | Default embedding model ID |
| `getLocalModelIds` | `() => string[]` | List all catalog model IDs |
| `resolveLocalModel` | `(modelId: string) => ModelInfo` | Resolve friendly ID to HuggingFace model info |
| `resolveLocalEmbeddingModel` | `(modelId: string) => ModelInfo` | Resolve embedding model ID to HuggingFace model info |
| `ModelInfo` | type | `{ hfId, dtype, sizeMB, description, pooling? }` |
| `ChatMessage` | type | `{ role: "system" \| "user" \| "assistant", content: string }` |
| `GenerateOptions` | type | `{ maxNewTokens?, temperature?, topP?, topK?, stopSequences? }` |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `LanguageModel` | `ai` | AI SDK core type for model interface |
| `EmbeddingModel` | `ai` | AI SDK core type for embedding interface |
| `createOpenAI` | `@ai-sdk/openai` | OpenAI provider factory |
| `createAnthropic` | `@ai-sdk/anthropic` | Anthropic provider factory |
| `createGoogleGenerativeAI` | `@ai-sdk/google` | Google provider factory |
| `z` | `zod` | Schema validation |
| `ProjectScopedRegistryManager` | `../ai/registry-manager.ts` | Multi-tenant provider isolation |
| `createError`, `fromError`, `toError` | `#veryfront/errors/veryfront-error.ts` | Structured error creation and inspection |
| `getOpenAIEnvConfig`, `getAnthropicEnvConfig`, `getGoogleGenAIEnvConfig` | `#veryfront/config/env.ts` | Lazy per-request env var reading |
| `serverLogger` | `#veryfront/utils` | Structured logging |
| `importTransformers` | `#veryfront/compat/opaque-deps.ts` | Lazy dynamic import of HuggingFace transformers |
| `Tool`, `JsonSchema`, `zodToJsonSchema` | `#veryfront/tool`, `#veryfront/tool/schema` | Tool types for AI SDK adapter |

## Behaviors

### Behavior 1: Auto-initialization from environment variables
- **Given**: No providers have been registered yet (`autoInitialized === false`)
- **When**: Any of `resolveModel`, `hasModelProvider`, `getRegisteredModelProviders`, or `findAvailableCloudModel` is called
- **Then**: Shared provider factories for `openai`, `anthropic`, `google`, and `local` are registered (if not already present). `autoInitialized` is set to `true`. Subsequent calls are no-ops.
- **Edge cases**: If a provider was already registered via `registerModelProvider` before auto-init, auto-init skips that provider name.

### Behavior 2: Model resolution (`resolveModel`)
- **Given**: A `"provider/model"` string (e.g. `"openai/gpt-4o"`)
- **When**: `resolveModel` is called
- **Then**: The string is split at the first `/`. The provider factory is looked up (project-scoped first, then shared). The factory is invoked with the model ID portion, returning a `LanguageModel`.
- **Edge cases**:
  - Missing `/` throws a `config` error.
  - Empty provider or model name throws a `config` error.
  - Unknown provider throws an `agent` error listing available providers.
  - If the factory throws a `config` error (missing API key) and `local` is registered and not disabled, falls back to `local/smollm2-135m`.
  - If local AI is disabled via env var, the fallback throws `no_ai_available`.

### Behavior 3: Cloud model discovery (`findAvailableCloudModel`)
- **Given**: Cloud upgrade candidates ordered by preference: Anthropic, OpenAI, Google
- **When**: `findAvailableCloudModel` is called
- **Then**: Iterates candidates, returning the first `"provider/model"` string where the provider has an API key set and is registered. Returns `null` if none available.

### Behavior 4: Eager runtime verification (`ensureModelReady`)
- **Given**: A resolved `LanguageModel` instance
- **When**: `ensureModelReady` is called
- **Then**: If the model has `_isVfLocalModel === true`, eagerly loads the ONNX pipeline via `verifyLocalRuntime` to surface errors before HTTP streaming begins. For non-local models, returns immediately.

### Behavior 5: Local model creation (`createLocalModel`)
- **Given**: An optional model ID (defaults to `"smollm2-135m"`)
- **When**: `createLocalModel` is called
- **Then**: Returns a `LanguageModelV2`-compatible object with `doGenerate` and `doStream` methods. The object is marked with `_isVfLocalModel: true` and `provider: "local"`.
- **Edge cases**:
  - `doStream` checks `isLocalAIDisabled()` eagerly before creating the `ReadableStream` to allow proper 503 responses.
  - `no_ai_available` errors inside the stream are re-thrown (not enqueued as in-band errors).

### Behavior 6: Streaming text generation (`generateStream`)
- **Given**: A model ID, chat messages, and generation options
- **When**: `generateStream` is called
- **Then**: Resolves the model via catalog, loads/caches the ONNX pipeline, creates a `TextStreamer` bridge, and yields tokens as they are generated via an async generator with a queue-based callback bridge.
- **Edge cases**: ONNX/native-addon errors during pipeline loading are converted to `no_ai_available` errors. The transformers module cache is reset on these failures.

### Behavior 7: Model catalog resolution
- **Given**: A friendly model ID (e.g. `"smollm2-135m"`)
- **When**: `resolveLocalModel` or `resolveLocalEmbeddingModel` is called
- **Then**: Returns the matching `ModelInfo` from the catalog. If not found, treats the ID as a raw HuggingFace repository ID with default `q4` dtype and `0` size.

### Behavior 8: Pipeline caching and loading locks
- **Given**: A model info with HuggingFace ID
- **When**: `loadPipeline` is called (in both `local-engine.ts` and `local-embedding-engine.ts`)
- **Then**: Returns cached pipeline if available. If a load is in progress, returns the existing promise (prevents concurrent duplicate loads). Otherwise starts a new load, caches the result, and cleans up the lock.

### Behavior 9: AI SDK model/tool wrapping (`adapters/ai-sdk.ts`)
- **Given**: A model instance or VeryFront `Tool`
- **When**: `aiSDKModel`/`useAISDK`, `toAISDKTool`, or `toAISDKTools` is called
- **Then**: Returns a branded wrapper (`__type: "ai-sdk-model"`) or an AI SDK function-call formatted object. Tool schemas are resolved from `inputSchemaJson` first, then Zod conversion, with a fallback to `{ type: "object", properties: {} }`.

### Behavior 10: Local embedding generation (`embedTexts`)
- **Given**: A model ID and array of text strings
- **When**: `embedTexts` is called
- **Then**: Resolves the embedding model from catalog, loads/caches the feature-extraction pipeline, runs inference with mean pooling (or model-specified pooling) and L2 normalization, returns `number[][]`.

## Constraints
- Do NOT change public API signatures
- Do NOT modify files outside `src/provider/`
- Must pass: `deno fmt --check src/provider/`, `deno lint src/provider/`, `deno test --no-check --allow-all src/provider/`

## Error Handling

| Error Type | Condition | Thrown By |
|------------|-----------|-----------|
| `config` | Invalid `"provider/model"` string format | `resolveModel` |
| `config` | Missing API key for cloud provider | Auto-init factory (openai/anthropic/google) |
| `agent` | Unknown provider name | `resolveModel` |
| `no_ai_available` | `VERYFRONT_DISABLE_LOCAL_AI=1` | `isLocalAIDisabled` check in `resolveModel`, `doStream`, `getTransformers` |
| `no_ai_available` | ONNX Runtime native addon unavailable | `getTransformers`, `loadPipeline` |

All errors use the `createError`/`toError` pattern from `#veryfront/errors/veryfront-error.ts`, producing typed `VeryFrontError` instances that the chat handler can inspect for proper HTTP status codes (e.g. 503 for `no_ai_available`).

## Side Effects

- **Module-level singletons**: `pipelineCache`, `loadingLocks`, `transformersModule` in `local-engine.ts`; `pipelineCache`, `loadingLocks` in `local-embedding-engine.ts`; `manager`, `autoInitialized` in `model-registry.ts`.
- **File system**: ONNX model files are cached to `./.cache/models/` on first load.
- **Environment variable reads**: `getOpenAIEnvConfig()`, `getAnthropicEnvConfig()`, `getGoogleGenAIEnvConfig()` read env vars lazily per-request via AsyncLocalStorage.
- **Logging**: Uses `serverLogger.component("local-llm")` and `serverLogger.component("local-embedding")` for operational logging.

## Performance Constraints

- Cloud provider factories (`createOpenAI`, `createAnthropic`, `createGoogleGenerativeAI`) are lightweight constructors with no network calls, safe to instantiate per-resolution.
- The `@huggingface/transformers` import is lazy -- only triggered when a local model is actually used, keeping startup fast when API keys are present.
- Pipeline instances are cached by HuggingFace model ID. Loading locks prevent duplicate concurrent model downloads.
- `verifyLocalRuntime`/`ensureModelReady` use the same pipeline cache, so the cost is paid only once.

## Invariants

- A resolved `LanguageModel` from `resolveModel` is always a valid AI SDK `LanguageModelV2` instance.
- `autoInitializeFromEnv` runs at most once per process (guarded by `autoInitialized` flag), reset only by `clearModelProviders`.
- Project-scoped registrations override shared registrations for the same provider name.
- Local models always have `_isVfLocalModel: true` and `provider: "local"` set on the returned object.
- The `local` provider is always registered (no API key required) unless explicitly skipped by a prior `registerModelProvider("local", ...)` call.
