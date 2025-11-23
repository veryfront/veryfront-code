/**
 * MDX bundling service
 */

import { compile as compileMdx } from "@mdx-js/mdx";
import { bundlerLogger as logger } from "@veryfront/utils";

// PluggableList type for MDX plugins (not exported in current @mdx-js/mdx version)
type PluggableList = Array<any>;
import { extract } from "std/front_matter/yaml.ts";
import { dirname, join } from "std/path/mod.ts";
import { getRehypePlugins, getRemarkPlugins } from "@veryfront/transforms/plugins/plugin-loader.ts";
import type {
  BundleResult,
  BundlerOptions,
  MDXBundleOptions,
  MDXBundleResult,
} from "../types/bundler-types.ts";
import { extractImports, processImports } from "../utils/import-utils.ts";
import { getSlugFromPath } from "../utils/loader-utils.ts";

/**
 * Bundle MDX content
 */
export async function bundleMdx(
  source: { path: string; content: string },
  options: BundlerOptions,
  result: BundleResult,
  compileMDXForImport: (source: string, options: BundlerOptions) => Promise<string>,
): Promise<void> {
  try {
    // Extract frontmatter (handle content without frontmatter)
    let body = source.content;
    let frontmatter: Record<string, unknown> = {};

    // Check if content has frontmatter
    if (source.content.trim().startsWith("---")) {
      const extracted = extract(source.content);
      body = extracted.body;
      frontmatter = extracted.attrs as Record<string, unknown>;
    }

    // Get plugins - PluggableList is the official @mdx-js/mdx plugin array type
    const remarkPlugins = (await getRemarkPlugins(options.projectDir)) as unknown as PluggableList;
    const rehypePlugins = (await getRehypePlugins(options.projectDir)) as unknown as PluggableList;

    // Process imports
    const processedContent = await processImports(
      body,
      source.path,
      options.projectDir,
      async (importPath) => {
        if (importPath.endsWith(".mdx")) {
          try {
            const importContent = await Deno.readTextFile(importPath);
            const compiledImport = await compileMDXForImport(importContent, options);

            // Add to outputs
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

        // Validate local imports
        if (importPath.startsWith(".") || importPath.startsWith("/")) {
          const basePath = importPath.startsWith("/")
            ? join(options.projectDir, importPath)
            : join(dirname(source.path), importPath);

          // Check with various extensions
          const extensions = ["", ".js", ".ts", ".jsx", ".tsx", ".mjs"];
          let found = false;

          for (const ext of extensions) {
            try {
              await Deno.stat(basePath + ext);
              found = true;
              break;
            } catch {
              // Continue checking
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

    // Compile MDX
    const compiled = await compileMdx(processedContent, {
      outputFormat: "function-body",
      development: options.mode === "development",
      remarkPlugins,
      rehypePlugins,
      providerImportSource: undefined,
      // Don't set jsxImportSource to avoid automatic React imports
    });

    // Create the module code
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

    // Track dependencies
    const imports = extractImports(moduleCode);
    result.dependencies.set(source.path, imports);

    logger.debug(`Bundled MDX: ${source.path} -> ${outputPath}`);
  } catch (error) {
    logger.error(`Failed to bundle MDX ${source.path}`, error);
    result.errors.push(error as Error);
  }
}

/**
 * Bundle MDX with additional options
 */
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
    // Extract frontmatter (handle content without frontmatter)
    let body = content;
    let frontmatter: Record<string, unknown> = {};

    // Check if content has frontmatter
    if (content.trim().startsWith("---")) {
      const extracted = extract(content);
      body = extracted.body;
      frontmatter = extracted.attrs as Record<string, unknown>;
    }

    // Get default plugins and merge with provided ones
    const defaultRemarkPlugins = (await getRemarkPlugins(projectDir)) as unknown as PluggableList;
    const defaultRehypePlugins = (await getRehypePlugins(projectDir)) as unknown as PluggableList;
    const allRemarkPlugins: PluggableList = [...defaultRemarkPlugins, ...remarkPlugins];
    const allRehypePlugins: PluggableList = [...defaultRehypePlugins, ...rehypePlugins];

    // Compile MDX
    const compiled = await compileMdx(body, {
      outputFormat: "function-body",
      development: mode === "development",
      remarkPlugins: allRemarkPlugins,
      rehypePlugins: allRehypePlugins,
      providerImportSource: undefined,
      // Don't set jsxImportSource to avoid automatic React imports
    });

    // Extract dependencies
    const compiledStr = String(compiled);
    const dependencies = extractImports(compiledStr);

    // Create globals import
    const globalsImport = Object.keys(globals).length > 0
      ? `const { ${Object.keys(globals).join(", ")} } = globalThis;`
      : "";

    // Create the final code for bundling
    // The MDX compiler outputs a function body that expects React to be in scope
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
