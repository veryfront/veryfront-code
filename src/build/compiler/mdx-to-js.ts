import { isAbsolute, relative, resolve } from "#veryfront/compat/path/index.ts";
import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type { ContentProcessor } from "#veryfront/extensions/content/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  createFrontmatterModuleExpression,
  type MDXFrontmatter,
  normalizeMDXFrontmatter,
} from "./frontmatter.ts";

export type { MDXFrontmatter } from "./frontmatter.ts";

/** Runtime context for compiling one MDX or Markdown source. */
export interface CompileToJSOptions {
  /** Project root used to constrain and resolve `mdxPath`. */
  projectDir: string;
  /** Compilation mode passed to the configured content processor. */
  mode: "development" | "production";
  /** Runtime adapter used by the content processor. */
  adapter: RuntimeAdapter;
}

/** Standalone ESM output and normalized source frontmatter. */
export interface CompileToJSResult {
  code: string;
  frontmatter: MDXFrontmatter;
}

function resolveSourcePath(projectDir: string, mdxPath: string): string {
  const projectRoot = resolve(projectDir);
  const sourcePath = resolve(projectRoot, mdxPath);
  const projectRelativePath = relative(projectRoot, sourcePath);

  if (
    projectRelativePath === "" ||
    projectRelativePath.split(/[\\/]/)[0] === ".." ||
    isAbsolute(projectRelativePath)
  ) {
    throw new TypeError(`MDX source path is outside projectDir: ${mdxPath}`);
  }
  if (!/\.mdx?$/i.test(sourcePath)) {
    throw new TypeError(`MDX source path must end with .md or .mdx: ${mdxPath}`);
  }

  return sourcePath;
}

/** Compile MDX or Markdown to a standalone ESM module. */
export async function compileMDXToJS(
  mdxPath: string,
  mdxContent: string,
  options: CompileToJSOptions,
): Promise<CompileToJSResult> {
  if (typeof mdxPath !== "string" || !mdxPath.trim()) {
    throw new TypeError("mdxPath must be a non-empty string");
  }
  if (typeof mdxContent !== "string") throw new TypeError("mdxContent must be a string");
  if (!options || typeof options !== "object") throw new TypeError("options must be an object");
  if (typeof options.projectDir !== "string" || !options.projectDir.trim()) {
    throw new TypeError("projectDir must be a non-empty string");
  }
  if (options.mode !== "development" && options.mode !== "production") {
    throw new TypeError("mode must be development or production");
  }
  if (!options.adapter || typeof options.adapter !== "object") {
    throw new TypeError("adapter must be a runtime adapter");
  }
  const projectDir = resolve(options.projectDir);
  const sourcePath = resolveSourcePath(projectDir, mdxPath);
  const processor = resolveContract<ContentProcessor>("ContentProcessor");
  const compile = sourcePath.toLowerCase().endsWith(".mdx")
    ? processor.compileMdx.bind(processor)
    : processor.compileMarkdown.bind(processor);
  const compiled = await compile({
    projectDir,
    content: mdxContent,
    filePath: sourcePath,
    mode: options.mode,
    target: "server",
    outputFormat: "program",
  });
  if (typeof compiled.compiledCode !== "string" || !compiled.compiledCode.trim()) {
    throw new TypeError("Content processor returned invalid compiled code");
  }
  const frontmatter = normalizeMDXFrontmatter(compiled.frontmatter);
  const moduleCode = `${compiled.compiledCode}\nexport const frontmatter = ${
    createFrontmatterModuleExpression(frontmatter)
  };\n`;

  return { code: moduleCode, frontmatter };
}
