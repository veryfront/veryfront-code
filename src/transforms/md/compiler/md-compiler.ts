import { rendererLogger } from "#veryfront/utils";
import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type {
  CompilationMode,
  CompilationTarget,
  ContentProcessingResult,
  ContentProcessor,
} from "#veryfront/extensions/content/index.ts";
import { COMPILATION_ERROR } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { errorLogName, fileLogLabel } from "../../shared/log-context.ts";

const logger = rendererLogger.component("md-compiler");

function safeSourcePath(filePath?: string): string {
  return filePath ? fileLogLabel(filePath) : "memory";
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
  const sourcePath = safeSourcePath(filePath);
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
        logger.error("Compilation failed", {
          sourcePath,
          errorName: errorLogName(error),
        });

        throw COMPILATION_ERROR.create({
          detail: `Markdown compilation failed for ${sourcePath}.`,
        });
      }
    },
    {
      "md.sourcePath": sourcePath,
      "md.contentLength": content.length,
    },
  );
}
