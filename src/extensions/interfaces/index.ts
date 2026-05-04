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
  BundleResult,
  BundlerPlugin,
  BundlerPluginBuild,
  TransformOptions,
  TransformResult,
} from "./bundler.ts";

// Cache store
export type { CacheStore } from "./cache-store.ts";

// Token cache store (proxy-grade cache with scan + stats)
export type { TokenCacheEntry, TokenCacheStats, TokenCacheStore } from "./token-cache-store.ts";

// CSS processor
export type {
  CSSCompileOptions,
  CSSCompiler,
  CSSModuleSource,
  CSSProcessor,
  CSSStylesheetSource,
} from "./css-processor.ts";

// Content transformer
export type {
  CompilationMode,
  CompilationTarget,
  ContentCompileOptions,
  ContentPlugin,
  ContentRuntimeBundle,
  ContentTransformer,
} from "./content-transformer.ts";

// Database client
export type { DatabaseClient, QueryResult } from "./database-client.ts";

// Auth provider
export type {
  AuthProvider,
  SignOptions,
  TokenHeader,
  TokenPayload,
  VerifyOptions,
} from "./auth-provider.ts";

// Tracing exporter
export type { SpanData, TracerProvider, TracingExporter } from "./tracing-exporter.ts";

// AI provider (registry + per-provider contract)
export type { AIProvider, AIProviderConfig, AIProviderRegistry } from "./ai-provider.ts";
export { AIProviderRegistryName } from "./ai-provider.ts";

// Embedding provider
export type { EmbeddingOptions, EmbeddingProvider, EmbeddingResult } from "./embedding-provider.ts";

// Code parser
export type {
  ASTNode,
  CodeParser,
  GenerateOptions,
  GenerateResult,
  InjectJsxNodePositionsOptions,
  NodePath,
  ParseOptions,
  TraverseVisitor,
} from "./code-parser.ts";

// Schema validator
export type {
  InferSchema,
  InferShape,
  Schema,
  SchemaFactory,
  SchemaValidator,
  SchemaValidatorCoerce,
  ValidationFailure,
  ValidationIssue,
  ValidationResult,
  ValidationSuccess,
} from "./schema-validator.ts";

// Node compatibility
export type {
  KreuzbergExtractor,
  NodeCompat,
  NodeCompatSqliteDatabase,
  SqliteStatement,
} from "./node-compat.ts";
