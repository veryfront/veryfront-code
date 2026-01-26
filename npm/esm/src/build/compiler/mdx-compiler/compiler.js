import { bundlerLogger as logger } from "../../../utils/index.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
import { validateCompileParams, validateFileExists } from "./validator.js";
import { extractExports, parseFrontmatter } from "./frontmatter-parser.js";
import { compileMDX } from "./mdx-processor.js";
import { transformFinalImports, transformImports } from "./import-transformer.js";
import { generateModuleCode } from "./code-generator.js";
import { transpileCode } from "./transpiler.js";
import { writeCompiledFile } from "./file-writer.js";
export function compileMDXFile(filePath, content, options) {
    return withSpan("mdx.compileMDXFile", async () => {
        validateCompileParams(filePath, content, options);
        await validateFileExists(filePath, content);
        logger.info(`Compiling MDX file: ${filePath}`);
        const { frontmatter: yamlFrontmatter, content: withoutYaml } = await parseFrontmatter(content);
        const { frontmatter: exportedVars, content: mdxContent } = extractExports(withoutYaml);
        const frontmatter = { ...yamlFrontmatter, ...exportedVars };
        try {
            const { code: compiledCode, imports } = await compileMDX(mdxContent, options);
            logger.debug("MDX compiled output (first 500 chars):", compiledCode.substring(0, 500));
            const moduleCode = generateModuleCode(frontmatter, transformImports(compiledCode));
            const finalCode = transformFinalImports(await transpileCode(moduleCode, options));
            const outputPath = await writeCompiledFile(filePath, finalCode, options);
            logger.debug(`Compiled MDX to: ${outputPath}`);
            return { outputPath, frontmatter, imports };
        }
        catch (error) {
            logger.error(`Failed to compile MDX file ${filePath}:`, error);
            throw error;
        }
    }, { "mdx.filePath": filePath });
}
