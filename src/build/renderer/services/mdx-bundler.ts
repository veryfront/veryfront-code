import { bundlerLogger as logger } from "#veryfront/utils";
import { extract } from "#std/front-matter/yaml.ts";
import { extname, isAbsolute, relative, resolve } from "#veryfront/compat/path/index.ts";
import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type { ContentPlugin, ContentProcessor } from "#veryfront/extensions/content/index.ts";
import { ensureError, MODULE_NOT_FOUND } from "#veryfront/errors";
import { createFileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
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

function projectRelativeSourcePath(path: string, projectDir: string): string {
  const relativePath = relative(resolve(projectDir), resolve(path)).replaceAll("\\", "/");
  if (relativePath === ".." || relativePath.startsWith("../") || isAbsolute(relativePath)) {
    throw new TypeError("MDX source must stay inside projectDir");
  }
  return relativePath;
}

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
  projectDir: string,
): Promise<string | null> {
  if (!isAbsolute(importPath)) return null;

  const extensions = [
    "",
    ".js",
    ".ts",
    ".jsx",
    ".tsx",
    ".mjs",
    ".cjs",
    ".mts",
    ".cts",
    ".json",
    ".css",
    ".mdx",
    ".md",
  ];

  for (const ext of extensions) {
    const candidate = `${importPath}${ext}`;
    try {
      const stat = fs.lstat ? await fs.lstat(candidate) : await fs.stat(candidate);
      if (stat.isSymlink) {
        throw new TypeError("Local imports must not resolve through a symbolic link");
      }
      if (!stat.isFile) continue;
      await assertCanonicalImportWithinProject(candidate, projectDir);
      return candidate;
    } catch (error) {
      if (isNotFoundError(error)) continue;
      throw error;
    }
  }

  const projectRelativePath = relative(resolve(projectDir), importPath).replaceAll("\\", "/");
  throw MODULE_NOT_FOUND.create({ detail: `Cannot find local module '${projectRelativePath}'` });
}

async function assertCanonicalImportWithinProject(path: string, projectDir: string): Promise<void> {
  if (!fs.realPath) return;
  const [canonicalProjectDir, canonicalPath] = await Promise.all([
    fs.realPath(resolve(projectDir)),
    fs.realPath(path),
  ]);
  const relativePath = relative(canonicalProjectDir, canonicalPath).replaceAll("\\", "/");
  if (relativePath === ".." || relativePath.startsWith("../") || isAbsolute(relativePath)) {
    throw new TypeError("Local import resolves outside projectDir");
  }
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
        const sourceRelativePath = projectRelativeSourcePath(source.path, options.projectDir);
        const pendingOutputs = new Map<
          string,
          BundleResult["outputs"] extends Map<string, infer T> ? T
            : never
        >();
        const { body, frontmatter } = extractFrontmatter(source.content);

        const processedContent = await processImports(
          body,
          source.path,
          options.projectDir,
          async (importPath) => {
            const resolvedImport = await validateLocalImport(importPath, options.projectDir);
            if (!resolvedImport || ![".md", ".mdx"].includes(extname(resolvedImport))) return null;

            const importContent = await fs.readTextFile(resolvedImport);
            const compiledImport = await compileMDXForImport(importContent, options);
            const outputPath = resolvedImport.replace(/\.mdx?$/, ".js");
            pendingOutputs.set(outputPath, {
              path: outputPath,
              content: compiledImport,
              type: "js",
            });
            return outputPath;
          },
        );

        const processor = resolveContract<ContentProcessor>("ContentProcessor");
        const compiled = await processor.compileMdx({
          projectDir: options.projectDir,
          content: processedContent,
          frontmatter,
          filePath: source.path,
          mode: options.mode,
          target: "server",
          outputFormat: "program",
        });

        const slug = getSlugFromPath(sourceRelativePath);
        const meta = {
          slug,
          title: frontmatter.title ?? slug,
          description: frontmatter.description ?? "",
          ...frontmatter,
        };

        const moduleCode = `${compiled.compiledCode}\nexport const meta = ${
          JSON.stringify(meta)
        };\n`;

        const outputPath = source.path.replace(/\.mdx?$/i, ".js");
        pendingOutputs.set(outputPath, {
          path: outputPath,
          content: moduleCode,
          type: "js",
          meta: frontmatter,
        });

        const dependencies = await extractImports(moduleCode);
        for (const [path, output] of pendingOutputs) result.outputs.set(path, output);
        result.dependencies.set(source.path, dependencies);

        logger.debug("Bundled MDX source");
      } catch (error) {
        logger.error("Failed to bundle MDX source");
        result.errors.push(ensureError(error));
      }
    },
    {
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

      logger.info("Bundling MDX file");

      try {
        projectRelativeSourcePath(filePath, options.projectDir);
        const { body, frontmatter } = extractFrontmatter(content);

        const processor = resolveContract<ContentProcessor>("ContentProcessor");
        const compiled = await processor.compileMdx({
          projectDir: options.projectDir,
          content: body,
          frontmatter,
          filePath,
          mode,
          target: "server",
          outputFormat: "program",
          remarkPlugins: normalizePlugins(remarkPlugins as ContentPlugin[]),
          rehypePlugins: normalizePlugins(rehypePlugins as ContentPlugin[]),
        });

        const compiledStr = compiled.compiledCode;
        const dependencies = await extractImports(compiledStr);

        const globalEntries = Object.entries(globals);
        const invalidGlobal = globalEntries.find(([key, globalName]) =>
          !isSafeBindingName(key) || typeof globalName !== "string" || !globalName.trim()
        );
        if (invalidGlobal) {
          throw new TypeError(`Invalid MDX global binding: ${invalidGlobal[0]}`);
        }
        const globalsImport = globalEntries.length
          ? globalEntries.map(([key, globalName]) =>
            `const ${key} = globalThis[${JSON.stringify(globalName)}];`
          ).join("\n")
          : "";

        const code = `${globalsImport}\n${compiledStr}\nexport const meta = ${
          JSON.stringify(frontmatter)
        };\n`;

        return {
          code,
          frontmatter,
          dependencies,
        };
      } catch (error) {
        logger.error("Failed to bundle MDX");
        return {
          code: "",
          frontmatter: {},
          dependencies: [],
          errors: [ensureError(error)],
        };
      }
    },
    {
      "options.mode": options.mode ?? "production",
    },
  );
}

const RESERVED_BINDING_NAMES = new Set([
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "null",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

function isSafeBindingName(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !RESERVED_BINDING_NAMES.has(name);
}
