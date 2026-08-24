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
  ["RedisRuntimeProvider", "npm:@veryfront/ext-redis"],
  ["CSSProcessor", "@veryfront/ext-css-tailwind"],
  ["CSSOptimizationEngine", "@veryfront/ext-css-lightning"],
  ["CSSPurgingEngine", "@veryfront/ext-css-purgecss"],
  ["ImageOptimizationEngine", "@veryfront/ext-image-sharp"],
  ["ContentProcessor", "@veryfront/ext-content-mdx"],
  ["DocumentExtractor", "@veryfront/ext-document-kreuzberg"],
  ["AuthProvider", "@veryfront/ext-auth-jwt"],
  ["TracingExporter", "@veryfront/ext-observability-opentelemetry"],
  ["NodeTelemetryProvider", "@veryfront/ext-observability-opentelemetry"],
  ["LLMProvider:openai", "@veryfront/ext-llm-openai"],
  ["LLMProvider:anthropic", "@veryfront/ext-llm-anthropic"],
  ["LLMProvider:google", "@veryfront/ext-llm-google"],
  ["LLMProvider:local", "@veryfront/ext-llm-onnx"],
  ["CodeParser", "@veryfront/ext-parser-babel"],
  ["SchemaValidator", "@veryfront/ext-schema-zod"],
  ["SqliteStore", "@veryfront/ext-db-sqlite"],
  ["SandboxShellToolsProvider", "@veryfront/ext-sandbox-shell-tools"],
  ["NodeWebSocketServerProvider", "@veryfront/ext-node-websocket-ws"],
  // Skill frontmatter decoding and general YAML decoding are both satisfied by
  // the single parser bundled in ext-yaml.
  ["SkillDocumentParserProvider", "@veryfront/ext-yaml"],
  ["YamlParserProvider", "@veryfront/ext-yaml"],
]);

/** Return recommendation. */
export function getRecommendation(contractName: string): string | undefined {
  return recommendations.get(contractName);
}
