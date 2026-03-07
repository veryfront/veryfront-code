import { compile as compileMdx } from "@mdx-js/mdx";
import { bundlerLogger as logger } from "#veryfront/utils";
import type { PluggableList } from "unified";
import { extract } from "#std/front-matter/yaml.ts";
import { dirname, join } from "#veryfront/compat/path/index.ts";
import { getRehypePlugins, getRemarkPlugins } from "#veryfront/transforms/plugins/plugin-loader.ts";
import { ensureError } from "#veryfront/errors/veryfront-error.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type {
  BundleResult,
  BundlerOptions,
  MDXBundleOptions,
  MDXBundleResult,
} from "../types/bundler-types.ts";
import { extractImports, processImports } from "../utils/import-utils.ts";
import { getSlugFromPath } from "../utils/loader-utils.ts";
import { normalizePlugins } from "../utils/plugin-utils.ts";

const fs = createFileSystem();

function extractFrontmatter(
  content: string,
): { body: string; frontmatter: Record<string, unknown> } {
  if (!content.trim().startsWith("---")) {
    return { body: content, frontmatter: {} };
  }

  const extracted = extract(content);
  return {
    body: extracted.body,
    frontmatter: extracted.attrs as Record<string, unknown>,
  };
}

async function validateLocalImport(
  importPath: string,
  sourcePath: string,
  projectDir: string,
  result: BundleResult,
): Promise<void> {
  if (!importPath.startsWith(".") && !importPath.startsWith("/")) return;

  const basePath = importPath.startsWith("/")
    ? join(projectDir, importPath)
    : join(dirname(sourcePath), importPath);

  const extensions = ["", ".js", ".ts", ".jsx", ".tsx", ".mjs"];

  for (const ext of extensions) {
    try {
      const stat = await fs.stat(basePath + ext);
      if (stat.isFile) return;
    } catch (_) {
      /* expected: file may not exist with this extension */
    }
  }

  result.errors.push(new Error(`Cannot find module '${importPath}' from '${sourcePath}'`));
}

/**
 * Bundle MDX content
 */
export function bundleMdx(
  source: { path: string; content: string },
  options: BundlerOptions,
  result: BundleResult,
  compileMDXForImport: (source: string, options: BundlerOptions) => Promise<string>,
): Promise<void> {
  return withSpan(
    "build.renderer.bundleMDX",
    async () => {
      try {
        const { body, frontmatter } = extractFrontmatter(source.content);

        const remarkPlugins = (await getRemarkPlugins()) as unknown as PluggableList;
        const rehypePlugins = (await getRehypePlugins()) as unknown as PluggableList;

        const processedContent = await processImports(
          body,
          source.path,
          options.projectDir,
          async (importPath) => {
            if (importPath.endsWith(".mdx")) {
              try {
                const importContent = await fs.readTextFile(importPath);
                const compiledImport = await compileMDXForImport(importContent, options);

                const outputPath = importPath.replace(/\.mdx$/, ".js");
                result.outputs.set(outputPath, {
                  path: outputPath,
                  content: compiledImport,
                  type: "js",
                });

                return outputPath;
              } catch (error) {
                logger.debug("Failed to compile MDX import", { importPath, error });
                return null;
              }
            }

            await validateLocalImport(importPath, source.path, options.projectDir, result);
            return null;
          },
        );

        const compiled = await compileMdx(processedContent, {
          outputFormat: "function-body",
          development: options.mode === "development",
          remarkPlugins: normalizePlugins(remarkPlugins),
          rehypePlugins: normalizePlugins(rehypePlugins),
          providerImportSource: undefined,
        });

        const slug = getSlugFromPath(source.path);
        const meta = {
          slug,
          title: frontmatter.title ?? slug,
          description: frontmatter.description ?? "",
          ...frontmatter,
        };

        const moduleCode = `
import React from 'react';
import { useMDXComponents } from '../shared/components/MDXProvider.tsx';

${String(compiled)}

export default function MDXContent(props) {
  const components = useMDXComponents();
  return MDXContentWrapper({ ...props, components });
}

export const meta = ${JSON.stringify(meta)};
`;

        const outputPath = source.path.replace(/\.mdx$/, ".js");
        result.outputs.set(outputPath, {
          path: outputPath,
          content: moduleCode,
          type: "js",
          meta: frontmatter,
        });

        result.dependencies.set(source.path, extractImports(moduleCode));

        logger.debug(`Bundled MDX: ${source.path} -> ${outputPath}`);
      } catch (error) {
        logger.error(`Failed to bundle MDX ${source.path}`, error);
        result.errors.push(ensureError(error));
      }
    },
    {
      "source.path": source.path,
      "options.mode": options.mode,
    },
  );
}

/**
 * Bundle MDX with additional options
 */
export function bundleMDXWithOptions(options: MDXBundleOptions): Promise<MDXBundleResult> {
  return withSpan(
    "build.renderer.bundleMDXWithOptions",
    async () => {
      const {
        content,
        filePath,
        mode = "production",
        globals = {},
        remarkPlugins = [],
        rehypePlugins = [],
      } = options;

      logger.info(`Bundling MDX file: ${filePath}`);

      try {
        const { body, frontmatter } = extractFrontmatter(content);

        const defaultRemarkPlugins = (await getRemarkPlugins()) as unknown as PluggableList;
        const defaultRehypePlugins = (await getRehypePlugins()) as unknown as PluggableList;

        const allRemarkPlugins = [
          ...normalizePlugins(defaultRemarkPlugins),
          ...normalizePlugins(remarkPlugins as PluggableList),
        ];
        const allRehypePlugins = [
          ...normalizePlugins(defaultRehypePlugins),
          ...normalizePlugins(rehypePlugins as PluggableList),
        ];

        const compiled = await compileMdx(body, {
          outputFormat: "function-body",
          development: mode === "development",
          remarkPlugins: allRemarkPlugins,
          rehypePlugins: allRehypePlugins,
          providerImportSource: undefined,
        });

        const compiledStr = String(compiled);
        const dependencies = extractImports(compiledStr);

        const globalKeys = Object.keys(globals);
        const globalsImport = globalKeys.length
          ? `const { ${globalKeys.join(", ")} } = globalThis;`
          : "";

        const code = `
import * as React from "react";
import { useMDXComponents } from "#veryfront/mdx-components';
${globalsImport}

${compiledStr}

export default function MDXContent(props) {
  const components = useMDXComponents();
  return MDXContentWrapper({ ...props, components });
}

export const meta = ${JSON.stringify(frontmatter)};
`;

        return {
          code,
          frontmatter,
          dependencies,
        };
      } catch (error) {
        logger.error(`Failed to bundle MDX: ${filePath}`, error);
        return {
          code: "",
          frontmatter: {},
          dependencies: [],
          errors: [ensureError(error)],
        };
      }
    },
    {
      "file.path": options.filePath,
      "options.mode": options.mode ?? "production",
    },
  );
}
