# Veryfront Extensions

First-party extension packages that provide pluggable capabilities to the Veryfront framework through the [contract-based extension system](../docs/guides/extensions.md).

Each extension registers one or more **contracts**. A contract is a typed interface that Veryfront resolves lazily at first use.

Extension availability is separate from contract requirement:

- Built-in extensions are auto-enabled by core bootstrap. You do not need to add them to `veryfront.config.ts`.
- Optional extensions are user-installed and configured when a project needs the feature.
- A contract becomes required only when a feature or extension resolves it. Missing required contracts throw an install-suggestion error at first use.

## Extension catalog

### LLM

| Package | Contract | Description |
|---------|----------|-------------|
| [`@veryfront/ext-llm-anthropic`](./ext-llm-anthropic) | `LLMProvider` | Anthropic Claude models via `@anthropic-ai/sdk` |
| [`@veryfront/ext-llm-google`](./ext-llm-google) | `LLMProvider` | Google Gemini models via `@google/generative-ai` |
| [`@veryfront/ext-llm-openai`](./ext-llm-openai) | `LLMProvider` | OpenAI models via `openai` SDK |

### Auth

| Package | Contract | Description |
|---------|----------|-------------|
| [`@veryfront/ext-auth-jwt`](./ext-auth-jwt) | `AuthProvider` | JWT sign/verify (HS256) and remote JWKS validation via `jose` |

### Build

| Package | Contract | Description |
|---------|----------|-------------|
| [`@veryfront/ext-bundler-esbuild`](./ext-bundler-esbuild) | `Bundler`, `ModuleLexer` | ESM bundling and module analysis via `esbuild` and `es-module-lexer` |
| [`@veryfront/ext-parser-babel`](./ext-parser-babel) | `CodeParser` | JS/TS AST parsing, traversal, and JSX source-position injection via Babel |
| [`@veryfront/ext-css-tailwind`](./ext-css-tailwind) | `CSSProcessor` | Tailwind CSS v4 compilation with dynamic plugin loading |

### Content

| Package | Contract | Description |
|---------|----------|-------------|
| [`@veryfront/ext-content-mdx`](./ext-content-mdx) | `ContentProcessor` | MDX and Markdown processing via unified/remark/rehype |

### Document extraction

| Package | Contract | Description |
|---------|----------|-------------|
| [`@veryfront/ext-document-kreuzberg`](./ext-document-kreuzberg) | `DocumentExtractor` | Document text extraction |

### Schema

| Package | Contract | Description |
|---------|----------|-------------|
| [`@veryfront/ext-schema-zod`](./ext-schema-zod) | `SchemaValidator` | Schema validation DSL backed by Zod |

### Storage

| Package | Contract | Description |
|---------|----------|-------------|
| [`@veryfront/ext-cache-redis`](./ext-cache-redis) | `TokenCacheStore` | Redis-backed token and cache persistence |
| [`@veryfront/ext-db-sqlite`](./ext-db-sqlite) | `SqliteStore` | SQLite persistence |

### Observability

| Package | Contract | Description |
|---------|----------|-------------|
| [`@veryfront/ext-tracing-opentelemetry`](./ext-tracing-opentelemetry) | `TracingExporter` | OpenTelemetry trace export via OTLP/HTTP |

### Sandbox

| Package | Contract | Description |
|---------|----------|-------------|
| [`@veryfront/ext-sandbox-shell-tools`](./ext-sandbox-shell-tools) | `SandboxShellToolsProvider` | Sandbox shell tool creation via `bash-tool` |

## Auto-enabled core extensions

These extensions are loaded by `createBuiltinExtensions()` during app bootstrap unless a project disables or overrides them by name.

| Package | Contracts |
|---------|-----------|
| `@veryfront/ext-schema-zod` | `SchemaValidator` |
| `@veryfront/ext-bundler-esbuild` | `Bundler`, `ModuleLexer` |
| `@veryfront/ext-parser-babel` | `CodeParser` |
| `@veryfront/ext-content-mdx` | `ContentProcessor` |
| `@veryfront/ext-css-tailwind` | `CSSProcessor` |
| `@veryfront/ext-document-kreuzberg` | `DocumentExtractor` |
| `@veryfront/ext-db-sqlite` | `SqliteStore` |
| `@veryfront/ext-sandbox-shell-tools` | `SandboxShellToolsProvider` |
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
| `DocumentExtractor` | Document text extraction runs | Auto-enabled native service extension |
| `SqliteStore` | SQLite-backed persistence runs | Auto-enabled native service extension |
| `SandboxShellToolsProvider` | Sandbox shell tools are created | Auto-enabled core extension |
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
