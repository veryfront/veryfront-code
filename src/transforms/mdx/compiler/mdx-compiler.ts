import type { Pluggable } from "unified";
import { rendererLogger as logger } from "#veryfront/utils";
import { getRehypePlugins, getRemarkPlugins } from "../../plugins/plugin-loader.ts";
import { extractFrontmatter } from "./frontmatter-extractor.ts";
import { rewriteBodyImports, rewriteCompiledImports } from "./import-rewriter.ts";
import type { CompilationMode, CompilationTarget, MdxRuntimeBundle } from "./types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { rehypeNodePositions } from "../../plugins/rehype-node-positions.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

type PluggableList = Pluggable[];

export function compileMDXRuntime(
  _mode: CompilationMode,
  projectDir: string,
  content: string,
  frontmatter?: Record<string, unknown>,
  filePath?: string,
  target: CompilationTarget = "server",
  baseUrl?: string,
  options?: {
    /** Enable node position injection for Studio Navigator */
    studioEmbed?: boolean;
  },
): Promise<MdxRuntimeBundle> {
  return withSpan("transforms.compileMDXRuntime", async () => {
    try {
      const { compile } = await import("@mdx-js/mdx");

      const remarkPlugins = (await getRemarkPlugins()) as unknown as PluggableList;
      const rehypePlugins = (await getRehypePlugins()) as unknown as PluggableList;

      const extracted = extractFrontmatter(content, frontmatter);
      let { body } = extracted;
      const { frontmatter: extractedFrontmatter } = extracted;

      const bodyBeforeLength = body.length;

      if (filePath && (target === "browser" || target === "server")) {
        body = rewriteBodyImports(body, { filePath, target, baseUrl, projectDir });
      }

      logger.debug("[MDX Compiler] Body metrics:", {
        filePath,
        target,
        contentLength: content.length,
        bodyBeforeLength,
        bodyAfterLength: body.length,
        hasImport: body.includes("import"),
        importMatch: body.match(/^import\s+/m)?.[0] || "none",
      });

      const allRehypePlugins: PluggableList = [
        ...rehypePlugins,
        ...(options?.studioEmbed && filePath
          ? [[rehypeNodePositions, { filePath }] as Pluggable]
          : []),
      ];

      // Always use production JSX mode for SSR stability.
      // Development mode outputs jsxDEV calls which require react/jsx-dev-runtime,
      // but this module resolution is flaky in some environments (especially CI).
      // Production mode uses jsx/jsxs which is always reliably available.
      const compiled = await compile(body, {
        outputFormat: "program",
        development: false,
        remarkPlugins,
        rehypePlugins: allRehypePlugins,
        providerImportSource: undefined,
        jsxImportSource: "react",
      });

      // Extract headings from the compiled VFile data (set by remarkMdxHeadings plugin)
      const headings =
        (compiled.data?.headings as Array<{ id: string; text: string; level: number }>) || [];

      logger.debug("MDX compiled output preview:", String(compiled).substring(0, 200));
      logger.debug("Extracted frontmatter:", extractedFrontmatter);
      logger.debug("Extracted headings count:", headings.length);

      let compiledCode = String(compiled);

      if (filePath && (target === "browser" || target === "server")) {
        compiledCode = rewriteCompiledImports(compiledCode, {
          filePath,
          target,
          baseUrl,
          projectDir,
        });
      }

      return {
        compiledCode,
        frontmatter: extractedFrontmatter,
        globals: {},
        headings,
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
  }, {
    "mdx.filePath": filePath ?? "memory",
    "mdx.target": target,
    "mdx.contentLength": content.length,
  });
}
