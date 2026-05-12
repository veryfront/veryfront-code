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
  ["CSSProcessor", "@veryfront/ext-css-tailwind"],
  ["ContentTransformer", "@veryfront/ext-transform-mdx"],
  ["DatabaseClient", "@veryfront/ext-postgres"],
  ["AuthProvider", "@veryfront/ext-auth-jwt"],
  ["TracingExporter", "@veryfront/ext-tracing-opentelemetry"],
  ["LLMProviderRegistry", "@veryfront/ext-llm-openai"],
  ["LLMProvider:openai", "@veryfront/ext-llm-openai"],
  ["LLMProvider:anthropic", "@veryfront/ext-llm-anthropic"],
  ["LLMProvider:google", "@veryfront/ext-llm-google"],
  ["EmbeddingProvider", "@veryfront/ext-embeddings"],
  ["CodeParser", "@veryfront/ext-parser-babel"],
  ["SchemaValidator", "@veryfront/ext-zod"],
  ["NodeCompat", "@veryfront/ext-node-compatibility"],
]);

export function getRecommendation(contractName: string): string | undefined {
  return recommendations.get(contractName);
}
