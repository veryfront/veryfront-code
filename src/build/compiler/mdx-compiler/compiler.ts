import { bundlerLogger as logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type { ContentProcessor } from "#veryfront/extensions/content/index.ts";
import type { CompileOptions, CompileResult, MDXFrontmatter } from "./types.ts";
import { validateCompileParams, validateFileExists } from "./validator.ts";
import { compileMDX } from "./mdx-processor.ts";
import { transpileCode } from "./transpiler.ts";
import { type CompileMDXFileDependencies, writeCompiledFile } from "./file-writer.ts";

export function compileMDXFile(
  filePath: string,
  content: string,
  options: CompileOptions,
  dependencies: CompileMDXFileDependencies = {},
): Promise<CompileResult> {
  return withSpan(
    "mdx.compileMDXFile",
    async () => {
      validateCompileParams(filePath, content, options);
      await validateFileExists(filePath, content);

      logger.info(`Compiling MDX file: ${filePath}`);

      const processor = resolveContract<ContentProcessor>("ContentProcessor");
      const extracted = processor.extractFrontmatter({
        content,
        syntax: "mdx",
      });
      const frontmatter = extracted.frontmatter as MDXFrontmatter;
      const generatedExports = {
        frontmatter,
        title: frontmatter.title === undefined ? "" : frontmatter.title,
        description: frontmatter.description === undefined ? "" : frontmatter.description,
        layout: frontmatter.layout === undefined ? true : frontmatter.layout,
      };

      try {
        const { code: compiledCode, imports } = await compileMDX(
          extracted.body,
          options,
          { exports: generatedExports },
        );

        logger.debug("MDX compiled output (first 500 chars):", compiledCode.substring(0, 500));

        const finalCode = await transpileCode(compiledCode, options);

        const outputPath = await writeCompiledFile(
          filePath,
          finalCode,
          options,
          dependencies,
        );

        logger.debug(`Compiled MDX to: ${outputPath}`);

        return { outputPath, frontmatter, imports };
      } catch (error) {
        logger.error(`Failed to compile MDX file ${filePath}:`, error);
        throw error;
      }
    },
    { "mdx.filePath": filePath },
  );
}
