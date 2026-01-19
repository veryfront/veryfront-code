import { bundlerLogger as logger } from "#veryfront/utils";
import type { CompileOptions, CompileResult, MDXFrontmatter } from "./types.ts";
import { validateCompileParams, validateFileExists } from "./validator.ts";
import { extractExports, parseFrontmatter } from "./frontmatter-parser.ts";
import { compileMDX } from "./mdx-processor.ts";
import { transformFinalImports, transformImports } from "./import-transformer.ts";
import { generateModuleCode } from "./code-generator.ts";
import { transpileCode } from "./transpiler.ts";
import { writeCompiledFile } from "./file-writer.ts";

export async function compileMDXFile(
  filePath: string,
  content: string,
  options: CompileOptions,
): Promise<CompileResult> {
  validateCompileParams(filePath, content, options);
  await validateFileExists(filePath, content);

  logger.info(`Compiling MDX file: ${filePath}`);

  const { frontmatter: yamlFrontmatter, content: withoutYaml } = await parseFrontmatter(content);
  const { frontmatter: exportedVars, content: mdxContent } = extractExports(withoutYaml);

  const frontmatter: MDXFrontmatter = { ...yamlFrontmatter, ...exportedVars };

  try {
    const { code: compiledCode, imports } = await compileMDX(mdxContent, options);

    logger.debug("MDX compiled output (first 500 chars):", compiledCode.substring(0, 500));

    const transformedCode = transformImports(compiledCode);
    const moduleCode = generateModuleCode(frontmatter, transformedCode);
    const transpiledCode = await transpileCode(moduleCode, options);
    const finalCode = transformFinalImports(transpiledCode);

    const outputPath = await writeCompiledFile(filePath, finalCode, options);

    logger.debug(`Compiled MDX to: ${outputPath}`);

    return {
      outputPath,
      frontmatter,
      imports,
    };
  } catch (error) {
    logger.error(`Failed to compile MDX file ${filePath}:`, error);
    throw error;
  }
}
