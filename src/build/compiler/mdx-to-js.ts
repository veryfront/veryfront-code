import { compile as compileMdx } from "@mdx-js/mdx";
import { bundlerLogger as logger } from "#veryfront/utils";
import * as esbuild from "esbuild";
import { extract } from "#std/front-matter/yaml.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

export interface MDXFrontmatter {
  title?: string;
  description?: string;
  layout?: boolean;
  [key: string]: unknown;
}

interface CompileToJSOptions {
  projectDir: string;
  mode: "development" | "production";
  components?: string[];
  adapter: RuntimeAdapter;
}

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

  if (!mdxContent.startsWith("---")) return { frontmatter: {}, content: mdxContent };

  const match = mdxContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match?.[1]) return { frontmatter: {}, content: mdxContent };

  try {
    const { parse } = await import("std/yaml/parse.ts");
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

  for (let match: RegExpExecArray | null; (match = importRegex.exec(content)) !== null;) {
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

  const componentList = imports.length ? `${imports.map((imp) => imp.name).join(", ")}, ` : "";

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
