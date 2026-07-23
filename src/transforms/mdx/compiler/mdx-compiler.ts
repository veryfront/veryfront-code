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

const logger = rendererLogger.component("mdx-compiler");

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
  const sourceFile = filePath === undefined ? "memory" : fileLogLabel(filePath);
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
        logger.error("Compilation failed", {
          sourceFile,
          errorName: errorLogName(error),
        });

        throw COMPILATION_ERROR.create({
          detail: `MDX compilation failed for ${sourceFile}.`,
        });
      }
    },
    {
      "mdx.source_file": sourceFile,
      "mdx.target": target,
      "mdx.contentLength": content.length,
    },
  );
}
