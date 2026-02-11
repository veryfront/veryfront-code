/**
 * Canonical component names for structured logging.
 *
 * These names are used with `logger.component("name")` to create
 * component-scoped loggers. The component field appears in JSON output
 * for Grafana/Loki filtering and as `[name]` in text output.
 *
 * Convention: lowercase-kebab-case.
 * Not enforced at runtime — any string is accepted. This registry is a
 * non-exhaustive reference to promote reuse and discoverability.
 *
 * @module
 */

export const LogComponents = {
  // Server & infrastructure
  server: "server",
  config: "config",
  middleware: "middleware",
  cors: "cors",
  security: "security",
  discovery: "discovery",
  pipeline: "pipeline",
  global: "global",

  // Rendering
  ssr: "ssr",
  ssrService: "ssr-service",
  ssrOrchestrator: "ssr-orchestrator",
  rsc: "rsc",
  html: "html",
  htmlGenerator: "html-generator",
  mdx: "mdx",
  mdxCompiler: "mdx-compiler",
  mdxCache: "mdx-cache",
  hmr: "hmr",
  hmrHandler: "hmr-handler",
  hmrServer: "hmr-server",
  renderer: "renderer",
  snippetRenderer: "snippet-renderer",

  // Build & transforms
  build: "build",
  esm: "esm",
  esmTransform: "esm-transform",
  ssrTransform: "ssr-transform",
  ssrModuleLoader: "ssr-module-loader",
  moduleLoader: "module-loader",
  moduleServer: "module-server",

  // Caching
  cache: "cache",
  cacheRegistry: "cache-registry",
  distributedCache: "distributed-cache",
  httpCache: "http-cache",
  httpCacheWrapper: "http-cache-wrapper",
  ssrHttpCache: "ssr-http-cache",
  fileCache: "file-cache",
  moduleCache: "module-cache",
  transformCache: "transform-cache",

  // API & HTTP
  api: "api",
  httpHandler: "http-handler",
  client: "client",
  runtimeHandler: "runtime-handler",

  // Platform & adapters
  redis: "redis",
  fsIntegration: "fs-integration",
  readOperations: "read-operations",

  // Observability
  otel: "otel",
  tracing: "tracing",
  metrics: "metrics",
  autoInstrument: "auto-instrument",
  perf: "perf",

  // Agent & AI
  agent: "agent",
  tool: "tool",

  // Workflow
  workflowDiscovery: "workflow-discovery",

  // Misc
  validator: "validator",
  error: "error",
  env: "env",
} as const;

export type LogComponent = (typeof LogComponents)[keyof typeof LogComponents];
