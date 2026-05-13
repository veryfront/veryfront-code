# Veryfront Extensions

First-party extension packages that provide pluggable capabilities to the Veryfront framework through the [contract-based extension system](../docs/guides/extensions.md).

Each extension registers one or more **contracts** — typed interfaces that the framework resolves lazily at first use. If an extension is missing, Veryfront throws an actionable error with the install command.

## Extension Catalog

### AI / LLM

| Package | Contract | Type | Description |
|---------|----------|------|-------------|
| [`@veryfront/ext-llm-anthropic`](./ext-llm-anthropic) | `LLMProvider:anthropic` | LLM Provider | Anthropic Claude models via `@anthropic-ai/sdk` |
| [`@veryfront/ext-llm-google`](./ext-llm-google) | `LLMProvider:google` | LLM Provider | Google Gemini models via `@google/generative-ai` |
| [`@veryfront/ext-llm-openai`](./ext-llm-openai) | `LLMProvider:openai` | LLM Provider | OpenAI models via `openai` SDK |

### Security

| Package | Contract | Type | Description |
|---------|----------|------|-------------|
| [`@veryfront/ext-auth-jwt`](./ext-auth-jwt) | `AuthProvider` | Auth | JWT sign/verify (HS256) and remote JWKS validation via `jose` |

### Build Pipeline

| Package | Contract | Type | Description |
|---------|----------|------|-------------|
| [`@veryfront/ext-bundler-esbuild`](./ext-bundler-esbuild) | `Bundler`, `ModuleLexer` | Build Tool | ESM bundling and module analysis via `esbuild` and `es-module-lexer` |
| [`@veryfront/ext-parser-babel`](./ext-parser-babel) | `CodeParser` | Build Tool | AST parsing, traversal, and code generation via Babel |
| [`@veryfront/ext-css-tailwind`](./ext-css-tailwind) | `CSSProcessor` | Build Tool | Tailwind CSS v4 compilation with dynamic plugin loading |

### Content

| Package | Contract | Type | Description |
|---------|----------|------|-------------|
| [`@veryfront/ext-transform-mdx`](./ext-transform-mdx) | `ContentTransformer` | Content | MDX and Markdown compilation via unified/remark/rehype |

### Validation

| Package | Contract | Type | Description |
|---------|----------|------|-------------|
| [`@veryfront/ext-zod`](./ext-zod) | `SchemaValidator` | Validation | Schema-first validation DSL backed by Zod |

### Infrastructure

| Package | Contract | Type | Description |
|---------|----------|------|-------------|
| [`@veryfront/ext-cache-redis`](./ext-cache-redis) | `TokenCacheStore` | Cache | Redis-backed token and cache persistence |
| [`@veryfront/ext-tracing-opentelemetry`](./ext-tracing-opentelemetry) | `TracingExporter` | Observability | OpenTelemetry trace export via OTLP/HTTP |
| [`@veryfront/ext-node-compatibility`](./ext-node-compatibility) | `NodeCompat` | Runtime | SQLite persistence and document text extraction (Kreuzberg) |

## Architecture

```
veryfront.config.ts          extensions/ext-*/deno.json
        │                              │
        ▼                              ▼
┌──────────────────────────────────────────┐
│         Extension Discovery              │
│  (config → packages → project → local)   │
└──────────────┬───────────────────────────┘
               ▼
┌──────────────────────────────────────────┐
│         Topological Sort                 │
│  (providers load before consumers)       │
└──────────────┬───────────────────────────┘
               ▼
┌──────────────────────────────────────────┐
│         setup(ctx)                       │
│  ctx.provide("ContractName", impl)       │
└──────────────┬───────────────────────────┘
               ▼
┌──────────────────────────────────────────┐
│         Runtime                          │
│  ctx.require("ContractName") → impl      │
└──────────────┬───────────────────────────┘
               ▼
┌──────────────────────────────────────────┐
│         teardown()                        │
│  (reverse load order)                    │
└──────────────────────────────────────────┘
```

## Package Structure

Each extension follows this layout:

```
ext-<name>/
├── deno.json         # Package metadata, version, capabilities
├── README.md         # Documentation
└── src/
    ├── index.ts      # ExtensionFactory (default export)
    └── index.test.ts # Tests
```

The `deno.json` declares:
- **name**: `@veryfront/ext-<name>`
- **version**: Semver string
- **exports**: Entry point (`./src/index.ts`)
- **veryfront.capabilities**: Contract registrations and runtime permissions

## Creating an Extension

```bash
veryfront extension init my-extension
```

See the [Extensions Guide](../docs/guides/extensions.md) for the full development workflow.
