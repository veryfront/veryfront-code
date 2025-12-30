import type { Pluggable } from "unified";
import { rendererLogger as logger } from "@veryfront/utils";
import { getRehypePlugins, getRemarkPlugins } from "../../plugins/plugin-loader.ts";
import { extractFrontmatter } from "./frontmatter-extractor.ts";
import { rewriteBodyImports, rewriteCompiledImports } from "./import-rewriter.ts";
import type { CompilationMode, CompilationTarget, MdxRuntimeBundle } from "./types.ts";
import { createError, toError } from "../../../../core/errors/veryfront-error.ts";

type PluggableList = Pluggable[];

export async function compileMDXRuntime(
  mode: CompilationMode,
  projectDir: string,
  content: string,
  frontmatter?: Record<string, unknown>,
  filePath?: string,
  target: CompilationTarget = "server",
  baseUrl?: string,
): Promise<MdxRuntimeBundle> {
  try {
    const { compile } = await import("@mdx-js/mdx");

    const remarkPlugins = (await getRemarkPlugins(projectDir)) as unknown as PluggableList;
    const rehypePlugins = (await getRehypePlugins(projectDir)) as unknown as PluggableList;

    const extracted = await extractFrontmatter(content, frontmatter);
    let { body } = extracted;
    const { frontmatter: extractedFrontmatter } = extracted;

    if (filePath && (target === "browser" || target === "server")) {
      body = rewriteBodyImports(body, { filePath, target, baseUrl, projectDir });
    }

    const compiled = await compile(body, {
      outputFormat: "program",
      development: mode === "development",
      remarkPlugins,
      rehypePlugins,
      providerImportSource: undefined,
      jsxImportSource: "react",
    });

    logger.info("MDX compiled output preview:", String(compiled).substring(0, 200));
    logger.info("Extracted frontmatter:", extractedFrontmatter);

    let compiledCode = String(compiled);

    if (filePath && (target === "browser" || target === "server")) {
      compiledCode = rewriteCompiledImports(compiledCode, { filePath, target, baseUrl, projectDir });
    }

    return {
      compiledCode,
      frontmatter: extractedFrontmatter,
      globals: {},
      headings: [],
      nodeMap: new Map(),
    };
  } catch (error) {
    logger.error("[MDX Compiler] Compilation failed:", {
      filePath,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw toError(createError({
      type: "build",
      message: `MDX compilation error: ${
        error instanceof Error ? error.message : String(error)
      } | file: ${filePath || "<memory>"}`,
    }));
  }
}
