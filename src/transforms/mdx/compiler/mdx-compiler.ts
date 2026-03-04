import type { Pluggable } from "unified";
import { rendererLogger } from "#veryfront/utils";
import { getRehypePlugins, getRemarkPlugins } from "../../plugins/plugin-loader.ts";
import { rehypeNodePositions } from "../../plugins/rehype-node-positions.ts";
import { extractFrontmatter } from "./frontmatter-extractor.ts";
import { rewriteBodyImports, rewriteCompiledImports } from "./import-rewriter.ts";
import type { CompilationMode, CompilationTarget, MdxRuntimeBundle } from "./types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const logger = rendererLogger.component("mdx-compiler");

type PluggableList = Pluggable[];

export function compileMDXRuntime(
  _mode: CompilationMode,
  projectDir: string,
  content: string,
  frontmatter?: Record<string, unknown>,
  filePath?: string,
  target: CompilationTarget = "server",
  baseUrl?: string,
): Promise<MdxRuntimeBundle> {
  return withSpan(
    "transforms.compileMDXRuntime",
    async () => {
      try {
        const { compile } = await import("@mdx-js/mdx");

        const remarkPlugins = (await getRemarkPlugins()) as unknown as PluggableList;
        const rehypePlugins = (await getRehypePlugins()) as unknown as PluggableList;

        if (filePath) {
          rehypePlugins.push([rehypeNodePositions, { filePath }] as unknown as Pluggable);
        }

        const { body: extractedBody, frontmatter: extractedFrontmatter } = extractFrontmatter(
          content,
          frontmatter,
        );

        const shouldRewriteImports = Boolean(filePath) &&
          (target === "browser" || target === "server");
        const body = shouldRewriteImports
          ? rewriteBodyImports(extractedBody, { filePath: filePath!, target, baseUrl, projectDir })
          : extractedBody;

        logger.debug("Body metrics:", {
          filePath,
          target,
          contentLength: content.length,
          bodyBeforeLength: extractedBody.length,
          bodyAfterLength: body.length,
          hasImport: body.includes("import"),
          importMatch: body.match(/^import\s+/m)?.[0] ?? "none",
        });

        const compiled = await compile(body, {
          outputFormat: "program",
          development: false,
          remarkPlugins,
          rehypePlugins,
          providerImportSource: undefined,
          jsxImportSource: "react",
        });

        const headings = (compiled.data?.headings as
          | Array<{ id: string; text: string; level: number }>
          | undefined) ??
          [];

        logger.debug("MDX compiled output preview:", String(compiled).substring(0, 200));
        logger.debug("Extracted frontmatter:", extractedFrontmatter);
        logger.debug("Extracted headings count:", headings.length);

        const compiledString = String(compiled);
        const compiledCode = shouldRewriteImports
          ? rewriteCompiledImports(compiledString, {
            filePath: filePath!,
            target,
            baseUrl,
            projectDir,
          })
          : compiledString;

        return {
          compiledCode,
          frontmatter: extractedFrontmatter,
          globals: {},
          headings,
          nodeMap: new Map(),
        };
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
