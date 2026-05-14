# Veryfront Extensions

First-party extension packages that provide pluggable capabilities to the Veryfront framework through the [contract-based extension system](../docs/guides/extensions.md).

Each extension registers one or more **contracts**. A contract is a typed interface that Veryfront resolves lazily at first use.

Extension availability is separate from contract requirement:

- Built-in extensions are auto-enabled by core bootstrap. You do not need to add them to `veryfront.config.ts`.
- Optional extensions are user-installed and configured when a project needs the feature.
- A contract becomes required only when a feature or extension resolves it. Missing required contracts throw an install-suggestion error at first use.

## Extension Catalog

### AI / LLM

| Package | Contract | Description |
|---------|----------|-------------|
| [`@veryfront/ext-llm-anthropic`](./ext-llm-anthropic) | `LLMProvider` | Anthropic Claude models via `@anthropic-ai/sdk` |
| [`@veryfront/ext-llm-google`](./ext-llm-google) | `LLMProvider` | Google Gemini models via `@google/generative-ai` |
| [`@veryfront/ext-llm-openai`](./ext-llm-openai) | `LLMProvider` | OpenAI models via `openai` SDK |

### Security

| Package | Contract | Description |
|---------|----------|-------------|
| [`@veryfront/ext-auth-jwt`](./ext-auth-jwt) | `AuthProvider` | JWT sign/verify (HS256) and remote JWKS validation via `jose` |

### Build Pipeline

| Package | Contract | Description |
|---------|----------|-------------|
| [`@veryfront/ext-bundler-esbuild`](./ext-bundler-esbuild) | `Bundler`, `ModuleLexer` | ESM bundling and module analysis via `esbuild` and `es-module-lexer` |
| [`@veryfront/ext-parser-babel`](./ext-parser-babel) | `CodeParser` | AST parsing, traversal, and code generation via Babel |
| [`@veryfront/ext-css-tailwind`](./ext-css-tailwind) | `CSSProcessor` | Tailwind CSS v4 compilation with dynamic plugin loading |

### Content

| Package | Contract | Description |
|---------|----------|-------------|
| [`@veryfront/ext-transform-mdx`](./ext-transform-mdx) | `ContentProcessor` | MDX and Markdown processing via unified/remark/rehype |

### Validation

| Package | Contract | Description |
|---------|----------|-------------|
| [`@veryfront/ext-zod`](./ext-zod) | `SchemaValidator` | Schema-first validation DSL backed by Zod |

### Infrastructure

| Package | Contract | Description |
|---------|----------|-------------|
| [`@veryfront/ext-cache-redis`](./ext-cache-redis) | `TokenCacheStore` | Redis-backed token and cache persistence |
| [`@veryfront/ext-tracing-opentelemetry`](./ext-tracing-opentelemetry) | `TracingExporter` | OpenTelemetry trace export via OTLP/HTTP |
| [`@veryfront/ext-node-compatibility`](./ext-node-compatibility) | `NodeCompat` | SQLite persistence and document text extraction (Kreuzberg) |

## Auto-enabled core extensions

These extensions are loaded by `createBuiltinExtensions()` during app bootstrap unless a project disables or overrides them by name.

| Package | Contracts |
|---------|-----------|
| `@veryfront/ext-zod` | `SchemaValidator` |
| `@veryfront/ext-bundler-esbuild` | `Bundler`, `ModuleLexer` |
| `@veryfront/ext-parser-babel` | `CodeParser` |
| `@veryfront/ext-transform-mdx` | `ContentProcessor` |
| `@veryfront/ext-css-tailwind` | `CSSProcessor` |
| `@veryfront/ext-node-compatibility` | `NodeCompat` |
| `@veryfront/ext-llm-openai` | `LLMProvider:openai` |
| `@veryfront/ext-llm-anthropic` | `LLMProvider:anthropic` |
| `@veryfront/ext-llm-google` | `LLMProvider:google` |

## Contract requirements

Veryfront treats contracts as required at the call site, not at the package list level.

| Contract | Required when | Default source |
|----------|---------------|----------------|
| `SchemaValidator` | Schema-backed runtime validation runs | Auto-enabled core extension |
| `Bundler`, `ModuleLexer` | Build, import analysis, or module bundling runs | Auto-enabled core extension |
| `CodeParser` | AST parsing or build-time code analysis runs | Auto-enabled core extension |
| `ContentProcessor` | MDX or Markdown content compilation runs | Auto-enabled core extension |
| `CSSProcessor` | Tailwind CSS processing runs | Auto-enabled core extension |
| `NodeCompat` | Node compatibility, SQLite persistence, or document extraction runs | Auto-enabled core extension |
| `LLMProvider:*` | A matching model provider is selected | Auto-enabled core extension |
| `AuthProvider` | Auth signing or verification is configured | User-installed extension |
| `TokenCacheStore` | Redis-backed token cache is configured | User-installed extension |
| `TracingExporter` | OTLP tracing export is configured | User-installed extension |

## Architecture

```
veryfront.config.ts          extensions/ext-*/deno.json
        │                              │
        ▼                              ▼
┌──────────────────────────────────────────┐
│         Extension Discovery              │
│  (config -> packages -> project -> local) │
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
│  ctx.require("ContractName") -> impl     │
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
