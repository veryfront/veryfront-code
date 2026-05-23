# Support matrix

This page keeps fast-moving support details short and explicit.

Use it for supported behavior.

## Router modes

Veryfront supports both router modes.

| Mode              | Primary file shapes                                                                                 | Notes                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| App router        | `app/**/page.*`, `app/api/**/route.*`                                                               | Directory-based routing model.                                             |
| Pages router      | `pages/**`, `pages/api/**`                                                                          | File-based routing model.                                                  |
| Router preference | `router: "app"` or `router: "pages"` in `veryfront.config.ts`                                       | The preferred router can be configured explicitly.                         |
| Fallback behavior | If the preferred router directory is missing, Veryfront falls back to the other router when present | This is a runtime convenience, not a reason to mix router styles casually. |

## Runtime targets

These are the runtime capability profiles modeled by the framework.

| Runtime            | Filesystem | MCP server | Long-running agents/workflows | Notes                                                                                 |
| ------------------ | ---------- | ---------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| Deno               | Yes        | Yes        | Yes                           | Primary local/runtime target in this repo.                                            |
| Node.js            | Yes        | Yes        | Yes                           | Full runtime profile.                                                                 |
| Bun                | Yes        | Yes        | Yes                           | Full runtime profile.                                                                 |
| Cloudflare Workers | No         | No         | Limited                       | Streaming is recommended; the runtime uses conservative step, CPU, and memory limits. |
| Unknown runtime    | No         | No         | Limited                       | Falls back to a constrained compatibility profile.                                    |

## Capability boundaries

This matrix separates open-core framework support from capabilities that depend
on a backing API or cloud bootstrap.

| Capability                                                            | Current support shape                             | Notes                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Routing, rendering, middleware, API routes                            | Open-core                                         | Core framework capability.                                                            |
| App MCP server                                                        | Open-core on runtimes that can host it            | Not available on constrained runtimes like Cloudflare Workers.                        |
| Internal AG-UI transport                                              | Open-core runtime surface                         | Separate from the app MCP contract.                                                   |
| Direct provider integrations (`openai`, `anthropic`, `google`, local) | Open-core with provider credentials/runtime setup | Depends on the selected provider configuration.                                       |
| Extension contracts (auth, bundler, CSS, parser, observability, etc.) | Open-core                                         | First-party `@veryfront/ext-*` packages provide implementations.                      |
| Workflow engine (in-memory and Redis backends)                        | Open-core                                         | K8sJobExecutor requires Kubernetes; in-memory/Redis work standalone.                  |
| Discovery (tools, agents, workflows, prompts, resources, skills)      | Open-core                                         | Convention-based file-system discovery at server startup.                             |
| Veryfront Cloud model routing                                         | Requires Veryfront Cloud bootstrap                | Depends on project/auth context and cloud gateway configuration.                      |
| Veryfront Cloud blob storage                                          | Requires Veryfront Cloud bootstrap                | Uses project-scoped cloud upload APIs.                                                |
| Veryfront Cloud agent service                                         | Requires Veryfront Cloud bootstrap                | Hosted agent execution with project steering and runtime system messages.             |
| Jobs client                                                           | Requires backing API/service layer                | Exposed as SDK/API surface, not as a built-in MCP jobs layer.                         |
| Sandbox                                                               | Requires backing API/service layer                | Depends on authenticated sandbox session APIs.                                        |
| Remote integration tools                                              | Requires backing API/service layer                | Tool definitions and execution are fetched per request from the configured API layer. |
| Control-plane agent routing                                           | Requires Veryfront Cloud bootstrap                | EdDSA-signed request validation for hosted agent orchestration.                       |

## Extension contract matrix

These contracts are backed by first-party extension packages. A contract is
required only when a feature resolves it. Built-in packages are auto-enabled by
core bootstrap; optional packages must be configured by the project.

| Contract                 | Package                                      | Availability | Required by                             | Runtime requirement          |
| ------------------------ | -------------------------------------------- | ------------ | --------------------------------------- | ---------------------------- |
| `SchemaValidator`        | `@veryfront/ext-schema-zod`                  | Built-in     | Schema-backed runtime validation        | None (pure JS)               |
| `Bundler`, `ModuleLexer` | `@veryfront/ext-bundler-esbuild`             | Built-in     | Build, import analysis, module bundling | esbuild binary               |
| `CSSProcessor`           | `@veryfront/ext-css-tailwind`                | Built-in     | Tailwind CSS processing                 | Network (esm.sh for plugins) |
| `ContentProcessor`       | `@veryfront/ext-content-mdx`                 | Built-in     | MDX or Markdown content compilation     | None (unified ecosystem)     |
| `CodeParser`             | `@veryfront/ext-parser-babel`                | Built-in     | AST parsing or build-time code analysis | None (Babel)                 |
| `DocumentExtractor`      | `@veryfront/ext-document-kreuzberg`          | Built-in     | Document text extraction                | FS (WASM/native extraction)  |
| `SqliteStore`            | `@veryfront/ext-db-sqlite`                   | Built-in     | SQLite-backed persistence               | FS (SQLite)                  |
| `LLMProvider`            | `@veryfront/ext-llm-openai`                  | Built-in     | OpenAI provider selection               | Network (OpenAI API)         |
| `LLMProvider`            | `@veryfront/ext-llm-anthropic`               | Built-in     | Anthropic provider selection            | Network (Anthropic API)      |
| `LLMProvider`            | `@veryfront/ext-llm-google`                  | Built-in     | Google provider selection               | Network (Google AI API)      |
| `AuthProvider`           | `@veryfront/ext-auth-jwt`                    | Optional     | Auth signing or verification            | None (jose library)          |
| `TracingExporter`        | `@veryfront/ext-observability-opentelemetry` | Optional     | OTLP tracing export                     | Network (OTLP endpoint)      |
| `NodeTelemetryProvider`  | `@veryfront/ext-observability-opentelemetry` | Built-in     | Node OpenTelemetry SDK bootstrap        | Network (OTLP endpoint)      |
| `TokenCacheStore`        | `@veryfront/ext-cache-redis`                 | Optional     | Redis-backed token cache                | Network (Redis)              |

## Dependency boundaries

Veryfront tracks third-party dependency ownership by boundary.

| Boundary  | Source                                                          | SBOM output                                 | Notes                                                                                                    |
| --------- | --------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Core      | Root [`deno.json`](../../deno.json) and [`src/`](../../src/)    | `core.json`                                 | The root framework boundary. [`src/`](../../src/) is not renamed to `core`; `core` is a reporting label. |
| CLI       | [`cli/deno.json`](../../cli/deno.json)                          | `cli.json`                                  | Command-line runtime boundary.                                                                           |
| React     | Root React import aliases and esm.sh deps                       | `react.json`                                | Tracks React and React DOM separately from core until React has a dedicated package split.               |
| Extension | `extensions/ext-*/deno.json`                                    | One file per extension package              | Each extension owns its npm and supported esm.sh dependencies.                                           |
| Aggregate | Boundary-specific manifests and resolved dependency graph       | `all.json`, `dependencies-by-manifest.json` | Use this view for full supply-chain inventory.                                                           |

## Documentation rule

When a feature depends on a backing API, managed service, or cloud bootstrap,
docs must say so directly instead of implying the open-core runtime provides
the full managed behavior by itself.

## Related guides

- [Deploying](../guides/deploying.md)
- [Configuration](../guides/configuration.md)

## Related reference

- [Reference index](../api-reference/index.md)
