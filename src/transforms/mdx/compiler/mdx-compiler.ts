import { rendererLogger } from "#veryfront/utils";
import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type {
  CompilationMode,
  CompilationTarget,
  ContentProcessingResult,
  ContentProcessor,
} from "#veryfront/extensions/content/index.ts";
import { MDX_COMPILE_ERROR, VeryfrontError } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { isFrontmatterSyntaxError } from "./frontmatter-extractor.ts";

const logger = rendererLogger.component("mdx-compiler");

function isMdxSourceCompileError(error: Error): boolean {
  const candidate = error as Error & {
    column?: unknown;
    line?: unknown;
    ruleId?: unknown;
    source?: unknown;
  };
  const isMdxParserError = typeof candidate.source === "string" &&
    /(?:^|-)mdx(?:-|$)|micromark|remark|recma|rehype/.test(candidate.source) &&
    typeof candidate.ruleId === "string" &&
    Number.isSafeInteger(candidate.line) &&
    Number.isSafeInteger(candidate.column);
  const isYamlFrontmatterError = error.name === "SyntaxError" &&
    /\bline \d+, column \d+\b/i.test(error.message) &&
    (error.stack?.includes("/src/platform/compat/std/front-matter-yaml.ts") === true ||
      error.stack?.includes("/src/platform/compat/std/yaml.ts") === true ||
      error.stack?.includes("/extensions/ext-yaml/src/adapter.ts") === true);
  return isMdxParserError || isYamlFrontmatterError || isFrontmatterSyntaxError(error);
}

export function compileMDXRuntime(
  mode: CompilationMode,
  projectDir: string,
  content: string,
  frontmatter?: Record<string, unknown>,
  filePath?: string,
  target: CompilationTarget = "server",
  baseUrl?: string,
  studioEmbed?: boolean,
): Promise<ContentProcessingResult> {
  return withSpan(
    "transforms.compileMDXRuntime",
    async () => {
      try {
        const processor = resolveContract<ContentProcessor>("ContentProcessor");
        return await processor.compileMdx({
          mode,
          projectDir,
          content,
          frontmatter,
          filePath,
          target,
          baseUrl,
          studioEmbed,
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error("Compilation failed:", {
          filePath,
          error: err.message,
          stack: err.stack,
        });

        if (err instanceof VeryfrontError || !isMdxSourceCompileError(err)) {
          throw err;
        }

        throw MDX_COMPILE_ERROR.create({
          detail: `MDX compilation error: ${err.message} | file: ${filePath ?? "<memory>"}`,
        });
      }
    },
    {
      "mdx.filePath": filePath ?? "memory",
      "mdx.target": target,
      "mdx.contentLength": content.length,
    },
  );
}
