import { compile as compileMdx } from "@mdx-js/mdx";
import { bundlerLogger as logger } from "@veryfront/utils";
import * as esbuild from "esbuild/mod.js"; // Native esbuild
import { extract } from "std/front_matter/yaml.ts";
import { dirname, join } from "@veryfront/platform/compat/path/index.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
import { createSecureFs } from "@veryfront/security";
import { createError, toError } from "@veryfront/errors/veryfront-error.ts";

export interface MDXFrontmatter {
  title?: string;
  description?: string;
  layout?: boolean;
  [key: string]: unknown;
}

export interface CompileToJSOptions {
  projectDir: string;
  mode: "development" | "production";
  components?: string[]; // List of available component names
  adapter: RuntimeAdapter; // Required for secure filesystem access
}

const fs = createFileSystem();

// Note: Native esbuild (esbuild/mod.js) doesn't need initialization - it auto-spawns a child process.
// Only WASM esbuild requires initialize() with wasmURL, which only works in browsers.

/**
 * Compile MDX to a standalone JS module
 */
export async function compileMDXToJS(
  mdxPath: string,
  mdxContent: string,
  options: CompileToJSOptions,
): Promise<{ code: string; frontmatter: MDXFrontmatter }> {
  let frontmatter: MDXFrontmatter = {};
  let content = mdxContent;

  try {
    const result = extract(mdxContent);
    frontmatter = result.attrs ? result.attrs as MDXFrontmatter : {};
    content = result.body;
  } catch (error) {
    logger.warn("Failed to extract frontmatter with gray-matter:", error);
    if (mdxContent.startsWith("---")) {
      const _match = mdxContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (_match && _match[1]) {
        try {
          const { parse } = await import("std/yaml/parse.ts");
          const parsed = parse(_match[1]);
          frontmatter = (parsed && typeof parsed === "object" ? parsed : {}) as MDXFrontmatter;
          if (!_match[2]) {
            throw toError(createError({
              type: "build",
              message: "MDX content missing after frontmatter",
            }));
          }
          content = String(_match[2]);
        } catch (yamlError) {
          logger.error("Failed to parse YAML frontmatter:", yamlError);
        }
      }
    }
  }

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

  const moduleCode = `
// Generated from ${mdxPath}
import * as React from "react";

export const frontmatter = ${JSON.stringify(frontmatter, null, 2)};
${
    imports
      .map((imp) => {
        const componentName = imp.path
          .split("/")
          .pop()
          ?.replace(/\.(jsx?|tsx?)$/, "") || imp.name;
        if (options.components?.includes(componentName)) {
          return `// ${imp.name} will be provided at runtime`;
        }
        return `const ${imp.name} = () => React.createElement('div', { className: 'missing-component' }, 'Component: ${imp.name}');`;
      })
      .join("\n")
  }
${
    String(compiled.value)
      .replace(/export\s+{\s*\w+\s+as\s+default\s*}/g, "")
      .replace(/export\s+default\s+/g, "")
  }
export default function MDXPage({ components = {} }) {
  ${
    imports
      .map((imp) => {
        const componentName = imp.path
          .split("/")
          .pop()
          ?.replace(/\.(jsx?|tsx?)$/, "") || imp.name;
        return `const ${imp.name} = components["${componentName}"] || components["${imp.name}"] || (() => React.createElement('div', { className: 'missing-component' }, 'Component: ${imp.name}'));`;
      })
      .join("\n  ")
  }
  
  return React.createElement(MDXContent, { components: { ${
    imports.length > 0 ? `${imports.map((imp) => imp.name).join(", ")}, ` : ""
  }...components } });

}
`;

  const result = await esbuild.transform(moduleCode, {
    loader: "jsx",
    jsx: "automatic",
    jsxImportSource: "react",
    format: "esm",
    target: options.mode === "development" ? "es2020" : "es2018",
  });

  return {
    code: result.code,
    frontmatter,
  };
}

export async function compileMDXFile(
  mdxPath: string,
  outputDir: string,
  options: CompileToJSOptions,
): Promise<void> {
  const secureFs = createSecureFs({
    baseDir: options.projectDir,
    adapter: options.adapter,
    context: "build", // Build context allows more flexibility
    throwOnError: true,
  });

  try {
    const content = await secureFs.readFile(mdxPath);
    const { code, frontmatter: _frontmatter } = await compileMDXToJS(mdxPath, content, options);

    const relativePath = mdxPath.replace(options.projectDir, "").replace(/^\//, "");
    const outputPath = join(outputDir, relativePath.replace(".mdx", ".mdx.js"));

    const dirPath = dirname(outputPath);
    await secureFs.mkdir(dirPath, { recursive: true });
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
  const compileOptions: CompileToJSOptions = {
    ...options,
    projectDir,
  };

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

  async function findMDXFiles(dir: string) {
    try {
      for await (const entry of fs.readDir(dir)) {
        const path = join(dir, entry.name);
        if (entry.isFile && entry.name.endsWith(".mdx")) {
          mdxFiles.push(path);
        } else if (
          entry.isDirectory &&
          !entry.name.startsWith(".") &&
          entry.name !== "node_modules"
        ) {
          await findMDXFiles(path);
        }
      }
    } catch {
      // Directory might not exist
    }
  }

  await findMDXFiles(join(projectDir, "pages"));
  await findMDXFiles(join(projectDir, "layouts"));
  await findMDXFiles(join(projectDir, "providers"));

  logger.info(`Found ${mdxFiles.length} MDX files to compile`);

  for (const mdxFile of mdxFiles) {
    await compileMDXFile(mdxFile, outputDir, compileOptions);
  }

  logger.info(`Compiled ${mdxFiles.length} MDX files to ${outputDir}`);
}
