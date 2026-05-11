import { rendererLogger } from "#veryfront/utils";
import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type {
  CompilationMode,
  CompilationTarget,
  ContentRuntimeBundle,
  ContentTransformer,
} from "#veryfront/extensions/content/index.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const logger = rendererLogger.component("md-compiler");

export function compileMarkdownRuntime(
  mode: CompilationMode,
  projectDir: string,
  content: string,
  frontmatter?: Record<string, unknown>,
  filePath?: string,
  target: CompilationTarget = "server",
  baseUrl?: string,
  studioEmbed?: boolean,
): Promise<ContentRuntimeBundle> {
  return withSpan(
    "transforms.compileMarkdownRuntime",
    async (): Promise<ContentRuntimeBundle> => {
      try {
        const transformer = resolveContract<ContentTransformer>("ContentTransformer");
        return await transformer.compileMarkdown({
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

        throw toError(
          createError({
            type: "build",
            message: `Markdown compilation error: ${err.message} | file: ${filePath ?? "<memory>"}`,
          }),
        );
      }
    },
    {
      "md.filePath": filePath ?? "memory",
      "md.contentLength": content.length,
    },
  );
}
