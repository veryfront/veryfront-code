/**
 * Maps contract names to recommended first-party extension packages.
 *
 * @module extensions/recommendations
 */

const recommendations = new Map<string, string>([
  ["Bundler", "@veryfront/ext-bundler-esbuild"],
  // ModuleLexer ships in the same package as Bundler (es-module-lexer +
  // esbuild are co-bundled into ext-bundler-esbuild).
  ["ModuleLexer", "@veryfront/ext-bundler-esbuild"],
  ["CacheStore", "@veryfront/ext-cache-redis"],
  ["TokenCacheStore", "@veryfront/ext-cache-redis"],
  ["CSSProcessor", "@veryfront/ext-tailwind"],
  ["ContentTransformer", "@veryfront/ext-mdx"],
  ["DatabaseClient", "@veryfront/ext-postgres"],
  ["AuthProvider", "@veryfront/ext-auth-jwt"],
  ["TracingExporter", "@veryfront/ext-opentelemetry"],
  ["AIProviderRegistry", "@veryfront/ext-ai-openai"],
  ["AIProvider:openai", "@veryfront/ext-ai-openai"],
  ["AIProvider:anthropic", "@veryfront/ext-ai-anthropic"],
  ["AIProvider:google", "@veryfront/ext-ai-google"],
  ["EmbeddingProvider", "@veryfront/ext-embeddings"],
  ["CodeParser", "@veryfront/ext-parser-babel"],
  ["SchemaValidator", "@veryfront/ext-zod"],
  ["NodeCompat", "@veryfront/ext-node-compat"],
]);

export function getRecommendation(contractName: string): string | undefined {
  return recommendations.get(contractName);
}
