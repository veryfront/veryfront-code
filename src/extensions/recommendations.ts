/**
 * Maps contract names to recommended first-party extension packages.
 *
 * @module extensions/recommendations
 */

const recommendations = new Map<string, string>([
  ["Bundler", "@veryfront/ext-esbuild"],
  // ModuleLexer ships in the same package as Bundler (es-module-lexer +
  // esbuild are co-bundled into ext-esbuild).
  ["ModuleLexer", "@veryfront/ext-esbuild"],
  ["CacheStore", "@veryfront/ext-redis"],
  ["TokenCacheStore", "@veryfront/ext-redis"],
  ["CSSProcessor", "@veryfront/ext-tailwind"],
  ["ContentTransformer", "@veryfront/ext-mdx"],
  ["DatabaseClient", "@veryfront/ext-postgres"],
  ["AuthProvider", "@veryfront/ext-jwt"],
  ["TracingExporter", "@veryfront/ext-opentelemetry"],
  ["LLMProviderRegistry", "@veryfront/ext-llm-openai"],
  ["LLMProvider:openai", "@veryfront/ext-llm-openai"],
  ["LLMProvider:anthropic", "@veryfront/ext-llm-anthropic"],
  ["LLMProvider:google", "@veryfront/ext-llm-google"],
  ["EmbeddingProvider", "@veryfront/ext-embeddings"],
  ["CodeParser", "@veryfront/ext-babel"],
  ["SchemaValidator", "@veryfront/ext-zod"],
  ["NodeCompat", "@veryfront/ext-node-compat"],
]);

export function getRecommendation(contractName: string): string | undefined {
  return recommendations.get(contractName);
}
