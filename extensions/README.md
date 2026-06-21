# Veryfront Extensions

First-party extension packages that provide pluggable capabilities to the
Veryfront framework through the
[contract-based extension system](../docs/guides/extensions.md).

Each extension registers one or more **contracts**. A contract is a typed
interface that Veryfront resolves lazily at first use.

Extension availability is separate from contract requirement:

- Built-in extensions are auto-enabled by core bootstrap. You do not need to add
  them to `veryfront.config.ts`.
- Optional extensions are user-installed and configured when a project needs the
  feature.
- A contract becomes required only when a feature or extension resolves it.
  Missing required contracts throw an install-suggestion error at first use.

## Extension catalog

### LLM

| Package                                               | Contract      | Description                                      |
| ----------------------------------------------------- | ------------- | ------------------------------------------------ |
| [`@veryfront/ext-llm-anthropic`](./ext-llm-anthropic) | `LLMProvider` | Anthropic Claude models via `@anthropic-ai/sdk`  |
| [`@veryfront/ext-llm-google`](./ext-llm-google)       | `LLMProvider` | Google Gemini models via `@google/generative-ai` |
| [`@veryfront/ext-llm-openai`](./ext-llm-openai)       | `LLMProvider` | OpenAI models via `openai` SDK                   |

### Auth

| Package                                     | Contract       | Description                                                   |
| ------------------------------------------- | -------------- | ------------------------------------------------------------- |
| [`@veryfront/ext-auth-jwt`](./ext-auth-jwt) | `AuthProvider` | JWT sign/verify (HS256) and remote JWKS validation via `jose` |

### Build

| Package                                                   | Contract                 | Description                                                               |
| --------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------- |
| [`@veryfront/ext-bundler-esbuild`](./ext-bundler-esbuild) | `Bundler`, `ModuleLexer` | ESM bundling and module analysis via `esbuild` and `es-module-lexer`      |
| [`@veryfront/ext-parser-babel`](./ext-parser-babel)       | `CodeParser`             | JS/TS AST parsing, traversal, and JSX source-position injection via Babel |
| [`@veryfront/ext-css-tailwind`](./ext-css-tailwind)       | `CSSProcessor`           | Tailwind CSS v4 compilation with dynamic plugin loading                   |

### Content

| Package                                           | Contract           | Description                                           |
| ------------------------------------------------- | ------------------ | ----------------------------------------------------- |
| [`@veryfront/ext-content-mdx`](./ext-content-mdx) | `ContentProcessor` | MDX and Markdown processing via unified/remark/rehype |

### Document extraction

| Package                                                         | Contract            | Description              |
| --------------------------------------------------------------- | ------------------- | ------------------------ |
| [`@veryfront/ext-document-kreuzberg`](./ext-document-kreuzberg) | `DocumentExtractor` | Document text extraction |

### Eval export

| Package                                                     | Contract                     | Description                                             |
| ----------------------------------------------------------- | ---------------------------- | ------------------------------------------------------- |
| [`@veryfront/ext-eval-report-http`](./ext-eval-report-http) | `EvalReportExporterRegistry` | Generic HTTP transport for redacted eval report exports |

### Schema

| Package                                         | Contract          | Description                         |
| ----------------------------------------------- | ----------------- | ----------------------------------- |
| [`@veryfront/ext-schema-zod`](./ext-schema-zod) | `SchemaValidator` | Schema validation DSL backed by Zod |

### Storage

| Package                                           | Contract          | Description                              |
| ------------------------------------------------- | ----------------- | ---------------------------------------- |
| [`@veryfront/ext-cache-redis`](./ext-cache-redis) | `TokenCacheStore` | Redis-backed token and cache persistence |
| [`@veryfront/ext-db-sqlite`](./ext-db-sqlite)     | `SqliteStore`     | SQLite persistence                       |

### Observability

| Package                                                                           | Contract                                   | Description                                                                  |
| --------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------- |
| [`@veryfront/ext-observability-opentelemetry`](./ext-observability-opentelemetry) | `TracingExporter`, `NodeTelemetryProvider` | OpenTelemetry trace export, metrics API bridge, and Node telemetry bootstrap |

### Sandbox

| Package                                                           | Contract                    | Description                                 |
| ----------------------------------------------------------------- | --------------------------- | ------------------------------------------- |
| [`@veryfront/ext-sandbox-shell-tools`](./ext-sandbox-shell-tools) | `SandboxShellToolsProvider` | Sandbox shell tool creation via `bash-tool` |

## Auto-enabled core extensions

These extensions are loaded by `createBuiltinExtensions()` during app bootstrap
unless a project disables or overrides them by name.

| Package                              | Contracts                   |
| ------------------------------------ | --------------------------- |
| `@veryfront/ext-schema-zod`          | `SchemaValidator`           |
| `@veryfront/ext-bundler-esbuild`     | `Bundler`, `ModuleLexer`    |
| `@veryfront/ext-parser-babel`        | `CodeParser`                |
| `@veryfront/ext-content-mdx`         | `ContentProcessor`          |
| `@veryfront/ext-css-tailwind`        | `CSSProcessor`              |
| `@veryfront/ext-document-kreuzberg`  | `DocumentExtractor`         |
| `@veryfront/ext-db-sqlite`           | `SqliteStore`               |
| `@veryfront/ext-sandbox-shell-tools` | `SandboxShellToolsProvider` |
| `@veryfront/ext-llm-openai`          | `LLMProvider:openai`        |
| `@veryfront/ext-llm-anthropic`       | `LLMProvider:anthropic`     |
| `@veryfront/ext-llm-google`          | `LLMProvider:google`        |

## Contract requirements

Veryfront treats contracts as required at the call site, not at the package list
level.

| Contract                    | Required when                                   | Default source                        |
| --------------------------- | ----------------------------------------------- | ------------------------------------- |
| `SchemaValidator`           | Schema-backed runtime validation runs           | Auto-enabled core extension           |
| `Bundler`, `ModuleLexer`    | Build, import analysis, or module bundling runs | Auto-enabled core extension           |
| `CodeParser`                | AST parsing or build-time code analysis runs    | Auto-enabled core extension           |
| `ContentProcessor`          | MDX or Markdown content compilation runs        | Auto-enabled core extension           |
| `CSSProcessor`              | Tailwind CSS processing runs                    | Auto-enabled core extension           |
| `DocumentExtractor`         | Document text extraction runs                   | Auto-enabled native service extension |
| `SqliteStore`               | SQLite-backed persistence runs                  | Auto-enabled native service extension |
| `SandboxShellToolsProvider` | Sandbox shell tools are created                 | Auto-enabled core extension           |
| `LLMProvider:*`             | A matching model provider is selected           | Auto-enabled core extension           |
| `AuthProvider`              | Auth signing or verification is configured      | User-installed extension              |
| `TokenCacheStore`           | Redis-backed token cache is configured          | User-installed extension              |
| `EvalReportExporterRegistry` | Eval report exporters are registered            | Auto-enabled core extension           |
| `TracingExporter`           | OTLP tracing export is configured               | User-installed extension              |
| `NodeTelemetryProvider`     | Node agent service telemetry is enabled         | Auto-enabled agent service extension  |

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
- **veryfront.contracts**: Contract metadata for discovery and audit
- **veryfront.capabilities**: Runtime permissions and audit metadata

The extension factory also declares runtime contract metadata:

```ts
import type { ExtensionFactory } from "veryfront/extensions";

const extCache: ExtensionFactory = () => ({
  name: "ext-cache-memory",
  version: "0.1.0",
  contracts: {
    provides: ["CacheStore"],
    requires: [],
  },
  capabilities: [],
  setup(ctx) {
    ctx.provide("CacheStore", createMemoryCache());
  },
});

export default extCache;
```

Static `provides` entries automatically declare provided contracts. Use
`contracts.provides` when a contract is registered dynamically in `setup()`.
Use `contracts.requires` before calling `ctx.require()` for contracts from
other extensions.

## Dependency ownership

Each extension owns its third-party dependencies through its own `deno.json`.
Run `deno task sbom:all --output-dir dist/dependency-sboms` from the repository
root to generate one SBOM per extension plus aggregate, core, CLI, and React
boundary views. Use `dependencies-by-manifest.json` in that output to inspect
the machine-readable grouped dependency list. Use `dependency-summary.md` for a
compact human-readable view with sensitive dependency boundaries highlighted.
The React boundary is owned by `react/deno.json`; extensions should keep their
own dependencies in their extension manifest.

## Sensitive dependency classes

Some extensions own dependencies that need extra review because they execute
commands, load native modules, or parse untrusted files. Keep these dependencies
inside their named extension boundaries.

| Class               | Extension                 | Boundary components                       | Capability surface             |
| ------------------- | ------------------------- | ----------------------------------------- | ------------------------------ |
| Sandbox execution   | `ext-sandbox-shell-tools` | `bash-tool`, `just-bash`                  | `SandboxShellToolsProvider`    |
| Native SQLite store | `ext-db-sqlite`           | `better-sqlite3`, `@types/better-sqlite3` | `SqliteStore`, filesystem I/O  |
| Document extraction | `ext-document-kreuzberg`  | `@kreuzberg/wasm`                         | `DocumentExtractor`, file read |

## Capability policy

Capabilities are part of the supply-chain boundary. Declare the same
capability list in the extension factory and in `veryfront.capabilities` inside
the extension manifest. CI runs `deno task lint:extension-capabilities` to
check for drift and to enforce the sensitive capability policies below.

| Extension                              | Required capabilities                                          | Why it is sensitive                         |
| -------------------------------------- | -------------------------------------------------------------- | ------------------------------------------- |
| `ext-sandbox-shell-tools`              | `sandbox:execute` with `tools: ["bash"]`                       | Exposes command execution in a sandbox      |
| `ext-cache-redis`                      | `net:outbound`, `env:read` for `REDIS_*`                       | Connects to external cache infrastructure   |
| `ext-db-sqlite`                        | `fs:read`, `fs:write`                                          | Opens native SQLite databases               |
| `ext-document-kreuzberg`               | `fs:read`                                                      | Parses uploaded or user-provided documents  |
| `ext-observability-opentelemetry`      | `net:outbound`, `env:read` for `OTEL_*`                        | Exports telemetry and reads collector config |
| `ext-eval-report-http`                 | `net:outbound`, `env:read` for `VERYFRONT_EVAL_HTTP_*`         | Exports eval reports to an external endpoint |

Use `veryfront.contracts` for contract ownership and dependency ordering. Use
`veryfront.capabilities` only for runtime resource access and audit metadata.

`deno task lint:dependency-boundaries` fails when one of these sensitive
boundaries is missing from the generated dependency index or no longer contains
its expected package components.

## Creating an Extension

```bash
veryfront extension init my-extension
```

See the [Extensions Guide](../docs/guides/extensions.md) for the full
development workflow.
