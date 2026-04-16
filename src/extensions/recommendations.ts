/**
 * Maps contract names to recommended first-party extension packages.
 *
 * @module extensions/recommendations
 */

const recommendations = new Map<string, string>([
  ["Bundler", "@veryfront/ext-esbuild"],
  ["CacheStore", "@veryfront/ext-redis"],
  ["CSSProcessor", "@veryfront/ext-tailwind"],
  ["ContentTransformer", "@veryfront/ext-mdx"],
  ["DatabaseClient", "@veryfront/ext-postgres"],
  ["AuthProvider", "@veryfront/ext-jwt"],
  ["TracingExporter", "@veryfront/ext-opentelemetry"],
  ["AIModelProvider", "@veryfront/ext-openai"],
  ["EmbeddingProvider", "@veryfront/ext-embeddings"],
  ["CodeParser", "@veryfront/ext-babel"],
  ["SchemaValidator", "@veryfront/ext-zod"],
  ["NodeCompat", "@veryfront/ext-node-compat"],
]);

export function getRecommendation(contractName: string): string | undefined {
  return recommendations.get(contractName);
}
