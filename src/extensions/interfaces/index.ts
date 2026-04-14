/**
 * Barrel export for all extension contract interfaces.
 *
 * Every export is a pure TypeScript type -- no runtime code is emitted.
 *
 * @module extensions/interfaces
 */

// Bundler
export type {
  BundleOptions,
  BundleOutput,
  Bundler,
  BundlerPlugin,
  BundlerPluginBuild,
  BundleResult,
  TransformOptions,
  TransformResult,
} from "./bundler.ts";

// Cache store
export type { CacheStore } from "./cache-store.ts";

// CSS processor
export type { CSSProcessOptions, CSSProcessor, CSSProcessResult } from "./css-processor.ts";

// Content transformer
export type {
  ContentTransformer,
  ContentTransformOptions,
  ContentTransformResult,
} from "./content-transformer.ts";

// Database client
export type { DatabaseClient, QueryResult } from "./database-client.ts";

// Auth provider
export type { AuthProvider, SignOptions, TokenPayload, VerifyOptions } from "./auth-provider.ts";

// Tracing exporter
export type { SpanData, TracingExporter } from "./tracing-exporter.ts";

// AI model provider
export type {
  AIModelProvider,
  ChatMessage,
  CompletionOptions,
  CompletionResult,
  ContentPart,
  StreamChunk,
  ToolDefinition,
} from "./ai-model-provider.ts";

// Embedding provider
export type { EmbeddingOptions, EmbeddingProvider, EmbeddingResult } from "./embedding-provider.ts";

// Code parser
export type {
  ASTNode,
  CodeParser,
  GenerateOptions,
  GenerateResult,
  NodePath,
  ParseOptions,
  TraverseVisitor,
} from "./code-parser.ts";

// Schema validator
export type {
  Schema,
  SchemaValidator,
  ValidationFailure,
  ValidationIssue,
  ValidationResult,
  ValidationSuccess,
} from "./schema-validator.ts";

// Node compatibility
export type { NodeCompat } from "./node-compat.ts";
