/**
 * Back-compat barrel for extension contract interfaces.
 *
 * Re-exports the category-folder modules under `../{ai,auth,cache,...}/`.
 * Most entries are interface re-exports (erased at runtime); the
 * `AIProviderRegistryName` re-export is a runtime value (a const).
 * This file will be deleted once all consumers migrate to the
 * `veryfront/extensions/<category>` paths.
 *
 * @module extensions/interfaces
 */

// Bundler + module lexer — moved to ../bundler/
export type {
  BuildContext,
  BuildFailure,
  BundleOptions,
  BundleOutput,
  Bundler,
  BundleResult,
  BundlerMessage,
  BundlerMessageLocation,
  BundlerPlugin,
  BundlerPluginBuild,
  Loader,
  Metafile,
  MetafileInput,
  MetafileOutput,
  OnLoadArgs,
  OnLoadResult,
  OnResolveArgs,
  OnResolveResult,
  StdinOptions,
  TransformOptions,
  TransformResult,
} from "../bundler/index.ts";
export type { ImportSpecifier, ModuleLexer } from "../bundler/index.ts";

// Cache store — moved to ../cache/
export type { CacheStore } from "../cache/index.ts";

// Token cache store — moved to ../cache/
export type { TokenCacheEntry, TokenCacheStats, TokenCacheStore } from "../cache/index.ts";

// CSS processor — moved to ../css/
export type {
  CSSCompileOptions, CSSCompiler, CSSModuleSource, CSSProcessor, CSSStylesheetSource,
} from "../css/index.ts";

// Content transformer — moved to ../content/
export type { CompilationMode, CompilationTarget, ContentPlugin } from "../content/index.ts";
export type { ContentCompileOptions, ContentRuntimeBundle, ContentTransformer } from "../content/index.ts";

// Database client
export type { DatabaseClient, QueryResult } from "./database-client.ts";

// Auth provider — moved to ../auth/
export type {
  AuthProvider,
  SignOptions,
  TokenHeader,
  TokenPayload,
  VerifyOptions,
} from "../auth/index.ts";

// Tracing exporter
export type { SpanData, TracerProvider, TracingExporter } from "./tracing-exporter.ts";

// AI provider (registry + per-provider contract) — moved to ../ai/
export type { AIProvider, AIProviderConfig, AIProviderRegistry } from "../ai/index.ts";
export { AIProviderRegistryName } from "../ai/index.ts";

// Embedding provider — moved to ../ai/
export type { EmbeddingOptions, EmbeddingProvider, EmbeddingResult } from "../ai/index.ts";

// Code parser — moved to ../parser/
export type {
  ASTNode,
  CodeParser,
  GenerateOptions,
  GenerateResult,
  InjectJsxNodePositionsOptions,
  NodePath,
  ParseOptions,
  TraverseVisitor,
} from "../parser/index.ts";

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
