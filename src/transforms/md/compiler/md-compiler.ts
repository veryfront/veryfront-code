import { rendererLogger } from "#veryfront/utils";
import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type {
  CompilationMode,
  CompilationTarget,
  ContentProcessingResult,
  ContentProcessor,
} from "#veryfront/extensions/content/index.ts";
import { MARKDOWN_COMPILE_ERROR, VeryfrontError } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { isFrontmatterSyntaxError } from "../../mdx/compiler/frontmatter-extractor.ts";

const logger = rendererLogger.component("md-compiler");

function isMarkdownSourceCompileError(error: Error): boolean {
  const isLegacyYamlError = error.name === "SyntaxError" &&
    /\bline \d+, column \d+\b/i.test(error.message) &&
    (error.stack?.includes("/src/platform/compat/std/front-matter-yaml.ts") === true ||
      error.stack?.includes("/src/platform/compat/std/yaml.ts") === true ||
      error.stack?.includes("/extensions/ext-yaml/src/adapter.ts") === true);
  return isLegacyYamlError || isFrontmatterSyntaxError(error);
}

export function compileMarkdownRuntime(
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
    "transforms.compileMarkdownRuntime",
    async (): Promise<ContentProcessingResult> => {
      try {
        const processor = resolveContract<ContentProcessor>("ContentProcessor");
        return await processor.compileMarkdown({
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

        if (err instanceof VeryfrontError || !isMarkdownSourceCompileError(err)) {
          throw err;
        }

        throw MARKDOWN_COMPILE_ERROR.create({
          detail: `Markdown compilation error: ${err.message} | file: ${filePath ?? "<memory>"}`,
        });
      }
    },
    {
      "md.filePath": filePath ?? "memory",
      "md.contentLength": content.length,
    },
  );
}
