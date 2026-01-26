import { compile as compileMdx } from "@mdx-js/mdx";
import { bundlerLogger as logger } from "../../../utils/index.js";
import { extract } from "../../../platform/compat/std/front-matter-yaml.js";
import { dirname, join } from "../../../platform/compat/path/index.js";
import { getRehypePlugins, getRemarkPlugins } from "../../../transforms/plugins/plugin-loader.js";
import { ensureError } from "../../../errors/veryfront-error.js";
import { createFileSystem } from "../../../platform/compat/fs.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
import { extractImports, processImports } from "../utils/import-utils.js";
import { getSlugFromPath } from "../utils/loader-utils.js";
import { normalizePlugins } from "../utils/plugin-utils.js";
const fs = createFileSystem();
function extractFrontmatter(content) {
    if (!content.trim().startsWith("---")) {
        return { body: content, frontmatter: {} };
    }
    const extracted = extract(content);
    return {
        body: extracted.body,
        frontmatter: extracted.attrs,
    };
}
async function validateLocalImport(importPath, sourcePath, projectDir, result) {
    if (!importPath.startsWith(".") && !importPath.startsWith("/"))
        return;
    const basePath = importPath.startsWith("/")
        ? join(projectDir, importPath)
        : join(dirname(sourcePath), importPath);
    const extensions = ["", ".js", ".ts", ".jsx", ".tsx", ".mjs"];
    for (const ext of extensions) {
        try {
            const stat = await fs.stat(basePath + ext);
            if (stat.isFile)
                return;
        }
        catch {
            // continue
        }
    }
    result.errors.push(new Error(`Cannot find module '${importPath}' from '${sourcePath}'`));
}
/**
 * Bundle MDX content
 */
export function bundleMdx(source, options, result, compileMDXForImport) {
    return withSpan("build.renderer.bundleMDX", async () => {
        try {
            const { body, frontmatter } = extractFrontmatter(source.content);
            const remarkPlugins = (await getRemarkPlugins());
            const rehypePlugins = (await getRehypePlugins());
            const processedContent = await processImports(body, source.path, options.projectDir, async (importPath) => {
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
                    }
                    catch {
                        return null;
                    }
                }
                await validateLocalImport(importPath, source.path, options.projectDir, result);
                return null;
            });
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
                title: frontmatter.title ? frontmatter.title : slug,
                description: frontmatter.description ? frontmatter.description : "",
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
            const imports = extractImports(moduleCode);
            result.dependencies.set(source.path, imports);
            logger.debug(`Bundled MDX: ${source.path} -> ${outputPath}`);
        }
        catch (error) {
            logger.error(`Failed to bundle MDX ${source.path}`, error);
            result.errors.push(ensureError(error));
        }
    }, {
        "source.path": source.path,
        "options.mode": options.mode,
    });
}
/**
 * Bundle MDX with additional options
 */
export function bundleMDXWithOptions(options) {
    return withSpan("build.renderer.bundleMDXWithOptions", async () => {
        const { content, filePath, mode = "production", globals = {}, remarkPlugins = [], rehypePlugins = [], } = options;
        logger.info(`Bundling MDX file: ${filePath}`);
        try {
            const { body, frontmatter } = extractFrontmatter(content);
            const defaultRemarkPlugins = (await getRemarkPlugins());
            const defaultRehypePlugins = (await getRehypePlugins());
            const allRemarkPlugins = [
                ...normalizePlugins(defaultRemarkPlugins),
                ...normalizePlugins(remarkPlugins),
            ];
            const allRehypePlugins = [
                ...normalizePlugins(defaultRehypePlugins),
                ...normalizePlugins(rehypePlugins),
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
        }
        catch (error) {
            logger.error(`Failed to bundle MDX: ${filePath}`, error);
            return {
                code: "",
                frontmatter: {},
                dependencies: [],
                errors: [ensureError(error)],
            };
        }
    }, {
        "file.path": options.filePath,
        "options.mode": options.mode ?? "production",
    });
}
