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
- Source and compiled-binary builds can load first-party extension source from
  this workspace. npm installs load extension implementations from the matching
  `@veryfront/ext-*` package, so services install only the extension packages
  they need.

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

| Package                                                   | Contract                  | Description                                                               |
| --------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------- |
| [`@veryfront/ext-bundler-esbuild`](./ext-bundler-esbuild) | `Bundler`, `ModuleLexer`  | ESM bundling and module analysis via `esbuild` and `es-module-lexer`      |
| [`@veryfront/ext-bundler-swc`](./ext-bundler-swc)         | `Bundler`                 | Opt-in legacy decorator metadata through SWC before esbuild bundling      |
| [`@veryfront/ext-css-lightning`](./ext-css-lightning)     | `CSSOptimizationEngine`   | Explicit CSS compilation, minification, browser targets, and source maps  |
| [`@veryfront/ext-css-purgecss`](./ext-css-purgecss)       | `CSSPurgingEngine`        | Explicit parser-backed unused and critical CSS extraction via PurgeCSS    |
| [`@veryfront/ext-css-tailwind`](./ext-css-tailwind)       | `CSSProcessor`            | Tailwind CSS v4 compilation with pinned local plugins                     |
| [`@veryfront/ext-image-sharp`](./ext-image-sharp)         | `ImageOptimizationEngine` | Explicit bounded native image transformation via Sharp                    |
| [`@veryfront/ext-parser-babel`](./ext-parser-babel)       | `CodeParser`              | JS/TS AST parsing, traversal, and JSX source-position injection via Babel |

### Content

| Package                                           | Contract                      | Description                                           |
| ------------------------------------------------- | ----------------------------- | ----------------------------------------------------- |
| [`@veryfront/ext-content-mdx`](./ext-content-mdx) | `ContentProcessor`            | MDX and Markdown processing via unified/remark/rehype |
| [`@veryfront/ext-yaml`](./ext-yaml)               | `SkillDocumentParserProvider` | YAML parsing for skill and agent documents            |

### Development and rendering

| Package                                                       | Contract                      | Description                                    |
| ------------------------------------------------------------- | ----------------------------- | ---------------------------------------------- |
| [`@veryfront/ext-dev-ui-react`](./ext-dev-ui-react)           | `DevUiAssetProvider`          | Offline assets for local development UI        |
| [`@veryfront/ext-node-websocket-ws`](./ext-node-websocket-ws) | `NodeWebSocketServerProvider` | Node.js WebSocket upgrades and local HMR       |
| [`@veryfront/ext-react-ssr`](./ext-react-ssr)                 | `IsolatedSsrRendererProvider` | Explicit renderer for isolated project workers |

### Document extraction

| Package                                                         | Contract            | Description              |
| --------------------------------------------------------------- | ------------------- | ------------------------ |
| [`@veryfront/ext-document-kreuzberg`](./ext-document-kreuzberg) | `DocumentExtractor` | Document text extraction |

### Eval export

| Package                                                         | Contract                     | Description                                             |
| --------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------- |
| [`@veryfront/ext-eval-report-http`](./ext-eval-report-http)     | `EvalReportExporterRegistry` | Generic HTTP transport for redacted eval report exports |
| [`@veryfront/ext-eval-report-mlflow`](./ext-eval-report-mlflow) | `EvalReportExporterRegistry` | MLflow Tracking exporter for redacted eval reports      |

Eval report exporters receive the generic, redacted `EvalReport` shape. Keep
project-specific extraction in eval adapters or metrics, then select an exporter
id such as `mlflow` from the CLI with `--export mlflow` or
`VERYFRONT_EVAL_EXPORTERS=mlflow`. Future vendor integrations such as
Braintrust should live as sibling `@veryfront/ext-eval-report-*` packages behind
the same contract.

### Schema

| Package                                         | Contract          | Description                         |
| ----------------------------------------------- | ----------------- | ----------------------------------- |
| [`@veryfront/ext-schema-zod`](./ext-schema-zod) | `SchemaValidator` | Schema validation DSL backed by Zod |

### Storage

| Package                                           | Contract               | Description                                         |
| ------------------------------------------------- | ---------------------- | --------------------------------------------------- |
| [`@veryfront/ext-blob-gcs`](./ext-blob-gcs)       | `BlobStorage`          | Google Cloud Storage object persistence             |
| [`@veryfront/ext-blob-s3`](./ext-blob-s3)         | `BlobStorage`          | S3-compatible object persistence                    |
| [`@veryfront/ext-cache-redis`](./ext-cache-redis) | `TokenCacheStore`      | Redis-backed token and cache persistence            |
| [`@veryfront/ext-redis`](./ext-redis)             | `RedisRuntimeProvider` | Shared Redis clients, adapters, and Pub/Sub runtime |
| [`@veryfront/ext-db-sqlite`](./ext-db-sqlite)     | `SqliteStore`          | SQLite persistence                                  |

### Observability

| Package                                                                           | Contract                                   | Description                                                                  |
| --------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------- |
| [`@veryfront/ext-observability-opentelemetry`](./ext-observability-opentelemetry) | `TracingExporter`, `NodeTelemetryProvider` | OpenTelemetry trace export, metrics API bridge, and Node telemetry bootstrap |
| [`@veryfront/ext-observability-sentry`](./ext-observability-sentry)               | Application error reporter                 | Sentry error capture with service and trace correlation                      |

### Sandbox

| Package                                                           | Contract                    | Description                                 |
| ----------------------------------------------------------------- | --------------------------- | ------------------------------------------- |
| [`@veryfront/ext-sandbox-shell-tools`](./ext-sandbox-shell-tools) | `SandboxShellToolsProvider` | Sandbox shell tool creation via `bash-tool` |

## Built-in first-party selection

These packages are known to `createBuiltinExtensions()`, but that does not make
every contract an unconditional global default. Direct built-ins are provided
by their owning source or service distribution. Deferred candidates load only
when the matching feature selects their contract. Deferred describes activation
timing, not implementation availability. Most deferred implementations are
package-backed and skip when the executing distribution does not contain their
package. The MLflow exporter is root-bundled but remains deferred until selected.
The standard `veryfront` npm/CLI package installs the baseline package-backed
subset used by ordinary apps and local development.

| Package                                      | Contract                      | Selection and availability                |
| -------------------------------------------- | ----------------------------- | ----------------------------------------- |
| `@veryfront/ext-schema-zod`                  | `SchemaValidator`             | Direct built-in                           |
| `@veryfront/ext-auth-jwt`                    | `AuthProvider`                | Deferred; install when auth is configured |
| `@veryfront/ext-bundler-esbuild`             | `Bundler`, `ModuleLexer`      | Deferred; standard npm baseline           |
| `@veryfront/ext-bundler-swc`                 | `Bundler`                     | Explicit; install for decorator metadata  |
| `@veryfront/ext-parser-babel`                | `CodeParser`                  | Deferred; standard npm baseline           |
| `@veryfront/ext-yaml`                        | `SkillDocumentParserProvider` | Deferred; standard npm baseline           |
| `@veryfront/ext-content-mdx`                 | `ContentProcessor`            | Deferred; standard npm baseline           |
| `@veryfront/ext-css-tailwind`                | `CSSProcessor`                | Deferred; standard npm baseline           |
| `@veryfront/ext-node-websocket-ws`           | `NodeWebSocketServerProvider` | Deferred; standard npm baseline           |
| `@veryfront/ext-dev-ui-react`                | `DevUiAssetProvider`          | Deferred; standard npm baseline           |
| `@veryfront/ext-document-kreuzberg`          | `DocumentExtractor`           | Deferred; source/service distribution     |
| `@veryfront/ext-db-sqlite`                   | `SqliteStore`                 | Deferred; source/service distribution     |
| `@veryfront/ext-sandbox-shell-tools`         | `SandboxShellToolsProvider`   | Deferred; source/service distribution     |
| `@veryfront/ext-observability-opentelemetry` | `TracingExporter`             | Deferred; install when OTLP is configured |
| `@veryfront/ext-observability-opentelemetry` | `NodeTelemetryProvider`       | Built into the owning agent service       |
| `@veryfront/ext-eval-report-http`            | Generic HTTP eval exporter    | Deferred; source/service distribution     |
| `@veryfront/ext-eval-report-mlflow`          | MLflow eval exporter          | Deferred; root-bundled                    |
| `@veryfront/ext-llm-openai`                  | `LLMProvider:openai`          | Direct service/source built-in            |
| `@veryfront/ext-llm-anthropic`               | `LLMProvider:anthropic`       | Direct service/source built-in            |
| `@veryfront/ext-llm-google`                  | `LLMProvider:google`          | Direct service/source built-in            |

## Explicit opt-in extensions

These packages must not become global defaults because they choose mutually
exclusive infrastructure, change build output, load native processors, or
select a specialized isolation implementation.

| Packages                                                      | Why activation stays explicit                         |
| ------------------------------------------------------------- | ----------------------------------------------------- |
| `@veryfront/ext-blob-s3`, `@veryfront/ext-blob-gcs`           | Competing credentialed `BlobStorage` implementations  |
| `@veryfront/ext-cache-redis`, `@veryfront/ext-redis`          | External Redis topology and credentials               |
| `@veryfront/ext-css-lightning`, `@veryfront/ext-css-purgecss` | Build-output policy and native/parser cost            |
| `@veryfront/ext-image-sharp`                                  | Native image processing and output policy             |
| `@veryfront/ext-react-ssr`                                    | Isolated-worker renderer selected by hosting topology |

## Service-conditional extensions

`@veryfront/ext-observability-sentry` is loaded by the owning server or agent
service only after its Sentry enablement, reporter-selection, and DSN policy
passes. It is not a normal application contract extension: automatically
running its package factory would register no useful contract, while eagerly
initializing the SDK would change process-wide error reporting and network
egress. Compiled services may embed the dormant adapter; npm services install
the runtime-specific package they execute.

## npm service installs

Install extension packages by the features a service executes. Do not install
raw transitive dependencies such as `bash-tool`, `just-bash`, `jose`,
`better-sqlite3`, `@aws-sdk/client-s3`, `@kreuzberg/node`, `@mdx-js/mdx`, or
`tailwindcss` directly to satisfy Veryfront runtime features.

| Runtime or service role                      | Install these extension packages                                                                                                                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI, build image, or project server runtime  | `@veryfront/ext-bundler-esbuild`, `@veryfront/ext-content-mdx`, `@veryfront/ext-css-tailwind`, `@veryfront/ext-dev-ui-react`, `@veryfront/ext-node-websocket-ws`, `@veryfront/ext-parser-babel`, `@veryfront/ext-yaml` |
| Build with CSS optimization                  | `@veryfront/ext-css-lightning` (register explicitly)                                                                                                                                                                   |
| Build with legacy decorator metadata         | `@veryfront/ext-bundler-swc` (register explicitly)                                                                                                                                                                     |
| Build with CSS purging or critical CSS       | `@veryfront/ext-css-purgecss` (register explicitly)                                                                                                                                                                    |
| Build with image optimization                | `@veryfront/ext-image-sharp` (register explicitly)                                                                                                                                                                     |
| Proxy or JWT-authenticated service           | `@veryfront/ext-auth-jwt`                                                                                                                                                                                              |
| Document upload or knowledge ingestion       | `@veryfront/ext-document-kreuzberg`                                                                                                                                                                                    |
| Redis-backed cache or token store            | `@veryfront/ext-cache-redis`                                                                                                                                                                                           |
| Redis-backed distributed runtime or Pub/Sub  | `@veryfront/ext-redis`                                                                                                                                                                                                 |
| S3-compatible blob persistence               | `@veryfront/ext-blob-s3`                                                                                                                                                                                               |
| Google Cloud Storage blob persistence        | `@veryfront/ext-blob-gcs`                                                                                                                                                                                              |
| SQLite-backed persistence                    | `@veryfront/ext-db-sqlite`                                                                                                                                                                                             |
| OpenTelemetry export or Node telemetry       | `@veryfront/ext-observability-opentelemetry`                                                                                                                                                                           |
| Sentry application error capture             | `@veryfront/ext-observability-sentry`                                                                                                                                                                                  |
| Local shell-tool agent runtime               | `@veryfront/ext-sandbox-shell-tools`                                                                                                                                                                                   |
| Eval report export to a generic HTTP gateway | `@veryfront/ext-eval-report-http`                                                                                                                                                                                      |
| Eval report export to MLflow                 | `@veryfront/ext-eval-report-mlflow`                                                                                                                                                                                    |

An agent runtime needs `@veryfront/ext-sandbox-shell-tools` only when it creates
local bash or shell tools. MCP-only remote tool execution does not need that
package unless the service also provides local shell tools.

## Contract requirements

Veryfront treats contracts as required at the call site, not at the package list
level.

| Contract                      | Required when                                   | Default source                        |
| ----------------------------- | ----------------------------------------------- | ------------------------------------- |
| `SchemaValidator`             | Schema-backed runtime validation runs           | Auto-enabled core extension           |
| `Bundler`, `ModuleLexer`      | Build, import analysis, or module bundling runs | Auto-enabled core extension           |
| `CodeParser`                  | AST parsing or build-time code analysis runs    | Auto-enabled core extension           |
| `ContentProcessor`            | MDX or Markdown content compilation runs        | Auto-enabled core extension           |
| `CSSProcessor`                | Class-candidate CSS processing runs             | Auto-enabled core extension           |
| `CSSOptimizationEngine`       | CSS compilation or minification runs            | Explicit user-installed extension     |
| `CSSPurgingEngine`            | CSS purging or critical-CSS extraction runs     | Explicit user-installed extension     |
| `ImageOptimizationEngine`     | Image optimization runs                         | Explicit user-installed extension     |
| `DocumentExtractor`           | Document text extraction runs                   | Auto-enabled native service extension |
| `SqliteStore`                 | SQLite-backed persistence runs                  | Auto-enabled native service extension |
| `SandboxShellToolsProvider`   | Sandbox shell tools are created                 | Auto-enabled core extension           |
| `LLMProvider:*`               | A matching model provider is selected           | Auto-enabled core extension           |
| `BlobStorage`                 | S3 or GCS object persistence is configured      | Explicitly configured extension       |
| `AuthProvider`                | Auth signing or verification is configured      | User-installed extension              |
| `TokenCacheStore`             | Redis-backed token cache is configured          | User-installed extension              |
| `RedisRuntimeProvider`        | A core Redis facade or Pub/Sub is used          | Explicitly configured extension       |
| `EvalReportExporterRegistry`  | Eval report exporters are registered            | Auto-enabled core extension           |
| `TracingExporter`             | OTLP tracing export is configured               | User-installed extension              |
| `NodeTelemetryProvider`       | Node agent service telemetry is enabled         | Auto-enabled agent service extension  |
| `NodeWebSocketServerProvider` | Node.js WebSocket upgrades or HMR run           | Auto-enabled core extension           |

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
`deno task build:npm` generates one publishable package per first-party
extension under `npm/extensions/`. The generated package keeps public
`veryfront/*` imports as peer imports and keeps feature-specific implementation
dependencies inside the extension package.

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
| Redis runtime       | `ext-redis`               | `redis`, `@redis/client`                  | Network and environment access |

## Capability policy

Capabilities are part of the supply-chain boundary. Declare the same
capability list in the extension factory and in `veryfront.capabilities` inside
the extension manifest. CI runs `deno task lint:extension-capabilities` to
check for drift and to enforce the sensitive capability policies below.

| Extension                         | Required capabilities                                           | Why it is sensitive                          |
| --------------------------------- | --------------------------------------------------------------- | -------------------------------------------- |
| `ext-blob-gcs`                    | `net:outbound` to Google OAuth and Storage                      | Obtains tokens and accesses configured blobs |
| `ext-blob-s3`                     | `net:outbound`, declared AWS runtime `env:read` keys            | Accesses the explicitly configured endpoint  |
| `ext-sandbox-shell-tools`         | `sandbox:execute` with `tools: ["bash"]`                        | Exposes command execution in a sandbox       |
| `ext-cache-redis`                 | `net:outbound`, `env:read` for `REDIS_*`                        | Connects to external cache infrastructure    |
| `ext-redis`                       | `net:outbound`, `env:read` for Redis connection settings        | Connects distributed runtime infrastructure  |
| `ext-db-sqlite`                   | `fs:read`, `fs:write`                                           | Opens native SQLite databases                |
| `ext-document-kreuzberg`          | `fs:read`, `process:spawn` for `deno`, `env:read`, `native:ffi` | Parses untrusted documents in a subprocess   |
| `ext-observability-opentelemetry` | `net:outbound`, `env:read` for `OTEL_*`                         | Exports telemetry and reads collector config |
| `ext-observability-sentry`        | `net:outbound`                                                  | Sends scrubbed application errors to Sentry  |
| `ext-eval-report-http`            | `net:outbound`, `env:read` for `VERYFRONT_EVAL_HTTP_*`          | Exports eval reports to an external endpoint |

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
