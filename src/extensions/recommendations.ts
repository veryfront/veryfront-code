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
  ["TokenCacheStore", "@veryfront/ext-cache-redis"],
  ["CSSProcessor", "@veryfront/ext-css-tailwind"],
  ["ContentProcessor", "@veryfront/ext-content-mdx"],
  ["DocumentExtractor", "@veryfront/ext-document-kreuzberg"],
  ["AuthProvider", "@veryfront/ext-auth-jwt"],
  ["TracingExporter", "@veryfront/ext-tracing-opentelemetry"],
  ["NodeTelemetryProvider", "@veryfront/ext-tracing-opentelemetry"],
  ["LLMProvider:openai", "@veryfront/ext-llm-openai"],
  ["LLMProvider:anthropic", "@veryfront/ext-llm-anthropic"],
  ["LLMProvider:google", "@veryfront/ext-llm-google"],
  ["CodeParser", "@veryfront/ext-parser-babel"],
  ["SchemaValidator", "@veryfront/ext-schema-zod"],
  ["SqliteStore", "@veryfront/ext-db-sqlite"],
  ["SandboxShellToolsProvider", "@veryfront/ext-sandbox-shell-tools"],
]);

export function getRecommendation(contractName: string): string | undefined {
  return recommendations.get(contractName);
}
