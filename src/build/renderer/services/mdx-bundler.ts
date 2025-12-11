
import { compile as compileMdx } from "@mdx-js/mdx";
import { bundlerLogger as logger } from "@veryfront/utils";
import type { Pluggable, PluggableList } from "unified";
import { extract } from "std/front_matter/yaml.ts";
import { dirname, join } from "std/path/mod.ts";
import { getRehypePlugins, getRemarkPlugins } from "@veryfront/transforms/plugins/plugin-loader.ts";
import { createFileSystem } from "../../../platform/compat/fs.ts";
import type {
  BundleResult,
  BundlerOptions,
  MDXBundleOptions,
  MDXBundleResult,
} from "../types/bundler-types.ts";
import { extractImports, processImports } from "../utils/import-utils.ts";
import { getSlugFromPath } from "../utils/loader-utils.ts";

const fs = createFileSystem();

export async function bundleMdx(
  source: { path: string; content: string },
  options: BundlerOptions,
  result: BundleResult,
  compileMDXForImport: (source: string, options: BundlerOptions) => Promise<string>,
): Promise<void> {
  try {
    let body = source.content;
    let frontmatter: Record<string, unknown> = {};

    if (source.content.trim().startsWith("---")) {
      const extracted = extract(source.content);
      body = extracted.body;
      frontmatter = extracted.attrs as Record<string, unknown>;
    }

    const remarkPlugins = (await getRemarkPlugins(options.projectDir)) as unknown as PluggableList;
    const rehypePlugins = (await getRehypePlugins(options.projectDir)) as unknown as PluggableList;

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
          } catch (_error) {
            return null;
          }
        }

        if (importPath.startsWith(".") || importPath.startsWith("/")) {
          const basePath = importPath.startsWith("/")
            ? join(options.projectDir, importPath)
            : join(dirname(source.path), importPath);

          const extensions = ["", ".js", ".ts", ".jsx", ".tsx", ".mjs"];
          let found = false;

          for (const ext of extensions) {
            try {
              const stat = await fs.stat(basePath + ext);
              if (stat.isFile) {
                found = true;
                break;
              }
            } catch {
            }
          }

          if (!found) {
            result.errors.push(
              new Error(`Cannot find module '${importPath}' from '${source.path}'`),
            );
          }
        }

        return null;
      },
    );

    const normalizePlugins = (plugins: PluggableList | undefined): Pluggable[] =>
      plugins === undefined
        ? []
        : Array.isArray(plugins)
        ? plugins.flat() as Pluggable[]
        : [plugins as Pluggable];

    const compiled = await compileMdx(processedContent, {
      outputFormat: "function-body",
      development: options.mode === "development",
      remarkPlugins: normalizePlugins(remarkPlugins as PluggableList),
      rehypePlugins: normalizePlugins(rehypePlugins as PluggableList),
      providerImportSource: undefined,
    });

    const slug = getSlugFromPath(source.path);
    const moduleCode = `
import React from 'react';
import { useMDXComponents } from '../shared/components/MDXProvider.tsx';

${String(compiled)}

export default function MDXContent(props) {
  const components = useMDXComponents();
  return MDXContentWrapper({ ...props, components });
}

export const meta = ${
      JSON.stringify({
        slug,
        title: frontmatter.title ? frontmatter.title : slug,
        description: frontmatter.description ? frontmatter.description : "",
        ...frontmatter,
      })
    };
`;

    const outputPath = source.path.replace(/\.mdx$/, ".js");
    result.outputs.set(outputPath, {
      path: outputPath,
      content: moduleCode,
      type: "js",
      meta: frontmatter,
    });

    const imports = extractImports(moduleCode);
    result.dependencies.set(source.path, imports);

    logger.debug(`Bundled MDX: ${source.path} -> ${outputPath}`);
  } catch (error) {
    logger.error(`Failed to bundle MDX ${source.path}`, error);
    result.errors.push(error as Error);
  }
}

export async function bundleMDXWithOptions(options: MDXBundleOptions): Promise<MDXBundleResult> {
  const {
    content,
    filePath,
    projectDir,
    mode = "production",
    globals = {},
    remarkPlugins = [],
    rehypePlugins = [],
  } = options;

  logger.info(`Bundling MDX file: ${filePath}`);

  try {
    let body = content;
    let frontmatter: Record<string, unknown> = {};

    if (content.trim().startsWith("---")) {
      const extracted = extract(content);
      body = extracted.body;
      frontmatter = extracted.attrs as Record<string, unknown>;
    }

    const normalizePlugins = (plugins: PluggableList | undefined): Pluggable[] =>
      plugins === undefined
        ? []
        : Array.isArray(plugins)
        ? plugins.flat() as Pluggable[]
        : [plugins as Pluggable];

    const defaultRemarkPlugins = (await getRemarkPlugins(projectDir)) as unknown as PluggableList;
    const defaultRehypePlugins = (await getRehypePlugins(projectDir)) as unknown as PluggableList;
    const allRemarkPlugins: Pluggable[] = [
      ...normalizePlugins(defaultRemarkPlugins),
      ...normalizePlugins(remarkPlugins as PluggableList),
    ];
    const allRehypePlugins: Pluggable[] = [
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

    const globalsImport = Object.keys(globals).length > 0
      ? `const { ${Object.keys(globals).join(", ")} } = globalThis;`
      : "";

    const code = `
import * as React from "react";
import { useMDXComponents } from '@veryfront/mdx-components';
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
      errors: [error as Error],
    };
  }
}
