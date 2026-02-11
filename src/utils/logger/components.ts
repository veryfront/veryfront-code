/**
 * Canonical component names for structured logging.
 *
 * These names are used with `logger.component("name")` to create
 * component-scoped loggers. The component field appears in JSON output
 * for Grafana/Loki filtering and as `[name]` in text output.
 *
 * Convention: lowercase-kebab-case.
 * Not enforced at runtime — serves as a registry/reference.
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

  // Rendering
  ssr: "ssr",
  rsc: "rsc",
  html: "html",
  mdx: "mdx",
  hmr: "hmr",

  // Build & transforms
  build: "build",
  esm: "esm",
  esmTransform: "esm-transform",
  ssrTransform: "ssr-transform",
  ssrModuleLoader: "ssr-module-loader",

  // Caching
  cache: "cache",
  httpCache: "http-cache",
  httpCacheWrapper: "http-cache-wrapper",
  ssrHttpCache: "ssr-http-cache",

  // API & HTTP
  api: "api",
  httpHandler: "http-handler",
  client: "client",

  // Agent & AI
  agent: "agent",
  tool: "tool",

  // Misc
  perf: "perf",
  validator: "validator",
  custom: "custom",
  error: "error",
  global: "global",
} as const;

export type LogComponent = (typeof LogComponents)[keyof typeof LogComponents];
