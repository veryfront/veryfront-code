import * as esbuild from "veryfront/extensions/bundler";
import { basename, dirname, isAbsolute, relative, resolve } from "#veryfront/compat/path/index.ts";
import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type { ContentProcessor } from "#veryfront/extensions/content/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { SECURITY_VIOLATION } from "#veryfront/errors";

const MAX_MDX_CHARACTERS = 16 * 1024 * 1024;
const MAX_PATH_CHARACTERS = 4_096;

export interface MDXFrontmatter {
  title?: string;
  description?: string;
  layout?: boolean;
  [key: string]: unknown;
}

export interface CompileToJSOptions {
  projectDir: string;
  mode: "development" | "production";
  /**
   * @deprecated Standard MDX `components` props are supported without a
   * compile-time allowlist. Retained so existing callers remain source-compatible.
   */
  components?: string[];
  adapter: RuntimeAdapter;
}

export interface CompileToJSResult {
  /** Compiled ESM preserving authored dependency imports. */
  code: string;
  /** Parser-validated YAML and static metadata exports. */
  frontmatter: MDXFrontmatter;
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function validatePath(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  if (value.length > MAX_PATH_CHARACTERS || hasControlCharacters(value)) {
    throw new TypeError(`${name} must be a safe filesystem path`);
  }
}

function validateOptions(options: CompileToJSOptions): void {
  if (!options || typeof options !== "object") {
    throw new TypeError("compileMDXToJS options must be an object");
  }
  validatePath(options.projectDir, "compileMDXToJS projectDir");
  if (options.mode !== "development" && options.mode !== "production") {
    throw new TypeError('compileMDXToJS mode must be either "development" or "production"');
  }
  if (
    !options.adapter ||
    typeof options.adapter !== "object" ||
    !options.adapter.fs ||
    typeof options.adapter.fs !== "object"
  ) {
    throw new TypeError("compileMDXToJS adapter must provide a filesystem");
  }
  if (
    options.components !== undefined &&
    (!Array.isArray(options.components) ||
      options.components.length > 1_024 ||
      options.components.some((name) =>
        typeof name !== "string" ||
        name.length === 0 ||
        name.length > 256 ||
        hasControlCharacters(name)
      ))
  ) {
    throw new TypeError("compileMDXToJS components must be a bounded array of names");
  }
}

function isContainedPath(basePath: string, candidatePath: string): boolean {
  const relativePath = relative(basePath, candidatePath);
  return relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith("../") &&
      !relativePath.startsWith("..\\") &&
      !isAbsolute(relativePath));
}

async function canonicalTargetPath(
  path: string,
  adapter: RuntimeAdapter,
): Promise<string> {
  const absolutePath = resolve(path);
  const realPath = adapter.fs.realPath?.bind(adapter.fs);
  if (!realPath) return absolutePath;

  try {
    return await realPath(absolutePath);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  const suffix: string[] = [];
  let current = absolutePath;
  while (true) {
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Cannot resolve an existing ancestor for ${path}`);
    }
    suffix.unshift(basename(current));
    try {
      return resolve(await realPath(parent), ...suffix);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      current = parent;
    }
  }
}

async function resolveSourcePath(
  mdxPath: string,
  options: CompileToJSOptions,
): Promise<string> {
  validatePath(mdxPath, "compileMDXToJS source path");
  if (!/\.mdx?$/i.test(mdxPath)) {
    throw new TypeError("compileMDXToJS source path must end with .md or .mdx");
  }

  const projectDir = resolve(options.projectDir);
  const sourcePath = isAbsolute(mdxPath) ? resolve(mdxPath) : resolve(projectDir, mdxPath);
  if (!isContainedPath(projectDir, sourcePath) || sourcePath === projectDir) {
    throw SECURITY_VIOLATION.create({
      detail: "compileMDXToJS source path resolves outside the project directory",
    });
  }

  const [canonicalProject, canonicalSource] = await Promise.all([
    canonicalTargetPath(projectDir, options.adapter),
    canonicalTargetPath(sourcePath, options.adapter),
  ]);
  if (!isContainedPath(canonicalProject, canonicalSource) || canonicalSource === canonicalProject) {
    throw SECURITY_VIOLATION.create({
      detail: "compileMDXToJS source path resolves outside the project directory",
    });
  }
  return sourcePath;
}

/**
 * Compile one MDX/Markdown document into standards-compliant ESM.
 *
 * Authored imports remain imports. Bundling is deliberately a caller concern,
 * which keeps this API deterministic and avoids silently replacing unresolved
 * components with placeholders.
 */
export async function compileMDXToJS(
  mdxPath: string,
  mdxContent: string,
  options: CompileToJSOptions,
): Promise<CompileToJSResult> {
  const compiled = await compileMDXProgram(mdxPath, mdxContent, options);
  const result = await esbuild.transform(compiled.code, {
    loader: "js",
    format: "esm",
    target: options.mode === "development" ? "es2020" : "es2018",
  });

  return { code: result.code, frontmatter: compiled.frontmatter };
}

/** @internal Compile MDX without starting a nested bundler operation. */
export async function compileMDXProgram(
  mdxPath: string,
  mdxContent: string,
  options: CompileToJSOptions,
): Promise<CompileToJSResult> {
  validateOptions(options);
  if (typeof mdxContent !== "string") {
    throw new TypeError("compileMDXToJS content must be a string");
  }
  if (mdxContent.length > MAX_MDX_CHARACTERS) {
    throw new RangeError(
      `compileMDXToJS content exceeds ${MAX_MDX_CHARACTERS} characters`,
    );
  }
  await resolveSourcePath(mdxPath, options);

  const processor = resolveContract<ContentProcessor>("ContentProcessor");
  const extracted = processor.extractFrontmatter({
    content: mdxContent,
    syntax: "mdx",
  });
  const frontmatter = extracted.frontmatter as MDXFrontmatter;
  const compiled = await processor.compileMdx({
    projectDir: resolve(options.projectDir),
    content: extracted.body,
    mode: options.mode,
    target: "server",
    moduleValues: {
      exports: { frontmatter },
    },
  });

  return { code: compiled.compiledCode, frontmatter };
}
