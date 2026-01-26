import { compile as compileMdx } from "@mdx-js/mdx";
import { bundlerLogger as logger } from "../../utils/index.js";
import * as esbuild from "esbuild";
import { extract } from "../../platform/compat/std/front-matter-yaml.js";
import { dirname, join } from "../../platform/compat/path/index.js";
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import { createFileSystem } from "../../platform/compat/fs.js";
import { createSecureFs } from "../../security/index.js";
import { createError, toError } from "../../errors/veryfront-error.js";

export interface MDXFrontmatter {
  title?: string;
  description?: string;
  layout?: boolean;
  [key: string]: unknown;
}

export interface CompileToJSOptions {
  projectDir: string;
  mode: "development" | "production";
  components?: string[];
  adapter: RuntimeAdapter;
}

const fs = createFileSystem();

function getComponentName(imp: { name: string; path: string }): string {
  return imp.path.split("/").pop()?.replace(/\.(jsx?|tsx?)$/, "") ?? imp.name;
}

async function extractFrontmatter(
  mdxContent: string,
): Promise<{ frontmatter: MDXFrontmatter; content: string }> {
  try {
    const result = extract(mdxContent);
    return {
      frontmatter: (result.attrs ?? {}) as MDXFrontmatter,
      content: result.body,
    };
  } catch (error) {
    logger.warn("Failed to extract frontmatter with gray-matter:", error);
  }

  if (!mdxContent.startsWith("---")) {
    return { frontmatter: {}, content: mdxContent };
  }

  const match = mdxContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match?.[1]) return { frontmatter: {}, content: mdxContent };

  try {
    const { parse } = await import("../../../deps/deno.land/std@0.220.0/yaml/parse.js");
    const parsed = parse(match[1]);
    const frontmatter = (parsed && typeof parsed === "object" ? parsed : {}) as MDXFrontmatter;

    if (!match[2]) {
      throw toError(
        createError({
          type: "build",
          message: "MDX content missing after frontmatter",
        }),
      );
    }

    return { frontmatter, content: String(match[2]) };
  } catch (yamlError) {
    logger.error("Failed to parse YAML frontmatter:", yamlError);
    return { frontmatter: {}, content: mdxContent };
  }
}

/**
 * Compile MDX to a standalone JS module
 */
export async function compileMDXToJS(
  mdxPath: string,
  mdxContent: string,
  options: CompileToJSOptions,
): Promise<{ code: string; frontmatter: MDXFrontmatter }> {
  const { frontmatter, content } = await extractFrontmatter(mdxContent);

  const importRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
  const imports: Array<{ name: string; path: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(content)) !== null) {
    const name = match[1];
    const path = match[2];
    if (name && path) imports.push({ name, path });
  }

  const contentWithoutImports = content.replace(/import\s+.*?from\s+['"].*?['"];?\s*/g, "");

  const compiled = await compileMdx(contentWithoutImports, {
    jsx: true,
    jsxRuntime: "automatic",
    jsxImportSource: "react",
    development: options.mode === "development",
  });

  const componentStubs = imports
    .map((imp) => {
      const componentName = getComponentName(imp);
      if (options.components?.includes(componentName)) {
        return `// ${imp.name} will be provided at runtime`;
      }
      return `const ${imp.name} = () => React.createElement('div', { className: 'missing-component' }, 'Component: ${imp.name}');`;
    })
    .join("\n");

  const compiledBody = String(compiled.value)
    .replace(/export\s+{\s*\w+\s+as\s+default\s*}/g, "")
    .replace(/export\s+default\s+/g, "");

  const runtimeComponentBindings = imports
    .map((imp) => {
      const componentName = getComponentName(imp);
      return `const ${imp.name} = components["${componentName}"] || components["${imp.name}"] || (() => React.createElement('div', { className: 'missing-component' }, 'Component: ${imp.name}'));`;
    })
    .join("\n  ");

  const componentList = imports.length > 0 ? `${imports.map((imp) => imp.name).join(", ")}, ` : "";

  const moduleCode = `
// Generated from ${mdxPath}
import * as React from "react";

export const frontmatter = ${JSON.stringify(frontmatter, null, 2)};
${componentStubs}
${compiledBody}
export default function MDXPage({ components = {} }) {
  ${runtimeComponentBindings}
  
  return React.createElement(MDXContent, { components: { ${componentList}...components } });

}
`;

  const result = await esbuild.transform(moduleCode, {
    loader: "jsx",
    jsx: "automatic",
    jsxImportSource: "react",
    format: "esm",
    target: options.mode === "development" ? "es2020" : "es2018",
  });

  return { code: result.code, frontmatter };
}

export async function compileMDXFile(
  mdxPath: string,
  outputDir: string,
  options: CompileToJSOptions,
): Promise<void> {
  const secureFs = createSecureFs({
    baseDir: options.projectDir,
    adapter: options.adapter,
    context: "build",
    throwOnError: true,
  });

  try {
    const content = await secureFs.readFile(mdxPath);
    const { code } = await compileMDXToJS(mdxPath, content, options);

    const relativePath = mdxPath.replace(options.projectDir, "").replace(/^\//, "");
    const outputPath = join(outputDir, relativePath.replace(".mdx", ".mdx.js"));

    await secureFs.mkdir(dirname(outputPath), { recursive: true });
    await secureFs.writeFile(outputPath, code);

    logger.info(`Compiled MDX: ${mdxPath} -> ${outputPath}`);
  } catch (error) {
    logger.error(`Failed to compile MDX file ${mdxPath}:`, error);
    throw error;
  }
}

export async function compileProjectMDX(
  projectDir: string,
  outputDir: string,
  options: Omit<CompileToJSOptions, "projectDir">,
): Promise<void> {
  const compileOptions: CompileToJSOptions = { ...options, projectDir };

  const componentsDir = join(projectDir, "components");
  const components: string[] = [];

  try {
    for await (const entry of fs.readDir(componentsDir)) {
      if (entry.isFile && /\.(jsx?|tsx?)$/.test(entry.name)) {
        components.push(entry.name.replace(/\.(jsx?|tsx?)$/, ""));
      }
    }
  } catch {
    // Components directory might not exist
  }

  compileOptions.components = components;

  const mdxFiles: string[] = [];
  const VERYFRONT_EXCLUDED_DIRS = new Set([
    "cache",
    "compiled",
    "tmp",
    "temp",
    "output",
    "optimized-images",
    "css",
  ]);

  async function findMDXFiles(dir: string): Promise<void> {
    try {
      for await (const entry of fs.readDir(dir)) {
        const path = join(dir, entry.name);

        if (entry.isFile && (entry.name.endsWith(".mdx") || entry.name.endsWith(".md"))) {
          mdxFiles.push(path);
          continue;
        }

        if (!entry.isDirectory || entry.name === "node_modules") continue;

        if (entry.name.startsWith(".") && entry.name !== ".veryfront") continue;
        if (dir.includes(".veryfront") && VERYFRONT_EXCLUDED_DIRS.has(entry.name)) continue;

        await findMDXFiles(path);
      }
    } catch {
      // Directory might not exist
    }
  }

  await findMDXFiles(join(projectDir, "pages"));
  await findMDXFiles(join(projectDir, "layouts"));
  await findMDXFiles(join(projectDir, "providers"));
  await findMDXFiles(join(projectDir, ".veryfront"));

  logger.info(`Found ${mdxFiles.length} MDX files to compile`);

  for (const mdxFile of mdxFiles) {
    await compileMDXFile(mdxFile, outputDir, compileOptions);
  }

  logger.info(`Compiled ${mdxFiles.length} MDX files to ${outputDir}`);
}
