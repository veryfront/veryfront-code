import { rendererLogger } from "#veryfront/utils";
import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type { ContentTransformer } from "#veryfront/extensions/interfaces/index.ts";
import type { CompilationMode, CompilationTarget, MdxRuntimeBundle } from "./types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

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
): Promise<MdxRuntimeBundle> {
  return withSpan(
    "transforms.compileMDXRuntime",
    async () => {
      try {
        const transformer = resolveContract<ContentTransformer>("ContentTransformer");
        return await transformer.compileMdx({
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
        logger.error("Compilation failed:", {
          filePath,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });

        throw toError(
          createError({
            type: "build",
            message: `MDX compilation error: ${
              error instanceof Error ? error.message : String(error)
            } | file: ${filePath ?? "<memory>"}`,
          }),
        );
      }
    },
    {
      "mdx.filePath": filePath ?? "memory",
      "mdx.target": target,
      "mdx.contentLength": content.length,
    },
  );
}
