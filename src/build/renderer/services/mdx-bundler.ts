import { bundlerLogger as logger } from "#veryfront/utils";
import {
  dirname,
  fromFileUrl,
  isAbsolute,
  join,
  relative,
  resolve,
  toFileUrl,
} from "#veryfront/compat/path/index.ts";
import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type { ContentPlugin, ContentProcessor } from "#veryfront/extensions/content/index.ts";
import { ensureError, MODULE_NOT_FOUND, SECURITY_VIOLATION } from "#veryfront/errors";
import { createFileSystem, isNotFoundError, realPath } from "#veryfront/platform/compat/fs.ts";
import { isWithinDirectory } from "#veryfront/security/path-validation.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type {
  BundleResult,
  BundlerOptions,
  MDXBundleOptions,
  MDXBundleResult,
} from "../types/bundler-types.ts";
import { getSlugFromPath } from "../utils/loader-utils.ts";
import {
  getModuleDependencies,
  parseModuleImports,
  replaceModuleImportSpecifiers,
} from "../utils/module-imports.ts";
import { normalizePlugins } from "../utils/plugin-utils.ts";

const fs = createFileSystem();
const MDX_PROVIDER_IMPORT_SOURCE = "veryfront/mdx";
const MDX_METADATA_EXPORT_NAME = "meta";
const LOCAL_IMPORT_SUFFIXES = [
  "",
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".mdx",
  ".mts",
  ".mjs",
  ".cts",
  ".cjs",
  ".json",
  ".css",
] as const;

interface ResolvedLocalImport {
  path: string;
  readPath: string;
  suffix: string;
}

type CompileMdxImport = (
  source: string,
  options: BundlerOptions,
  sourcePath: string,
) => Promise<string>;

interface StagedMdxOutput {
  path: string;
  content: string;
  type: "js";
}

interface MdxModuleGraphState {
  options: BundlerOptions;
  rootOutputPath: string;
  compileImport: CompileMdxImport;
  outputs: Map<string, StagedMdxOutput>;
  dependencies: Map<string, string[]>;
  activeOutputs: Set<string>;
  canonicalProjectDir?: Promise<string>;
}

function resolveProjectSourcePath(
  sourcePath: string,
  projectDir: string,
): { absolutePath: string; relativePath: string } {
  if (!isAbsolute(projectDir)) {
    throw new TypeError("MDX project directory must be absolute");
  }

  const absolutePath = isAbsolute(sourcePath) ? sourcePath : resolve(projectDir, sourcePath);
  const projectRelativePath = relative(projectDir, absolutePath);
  const isWithinProject = projectRelativePath !== "" &&
    projectRelativePath !== ".." &&
    !projectRelativePath.startsWith("../") &&
    !projectRelativePath.startsWith("..\\") &&
    !isAbsolute(projectRelativePath);

  if (!isWithinProject) {
    throw new TypeError(`MDX source path must be inside the project directory: ${sourcePath}`);
  }

  return { absolutePath, relativePath: projectRelativePath };
}

function createGlobalBindings(globals: Record<string, string>): Record<string, string> {
  const prototype = Object.getPrototypeOf(globals);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("MDX globals must be a plain object");
  }

  const entries: Array<[string, string]> = [];
  const descriptors = Object.getOwnPropertyDescriptors(globals);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key as keyof typeof descriptors];
    if (!descriptor?.enumerable) continue;
    if (typeof key !== "string") {
      throw new TypeError("MDX globals cannot contain enumerable symbol keys");
    }
    if (!("value" in descriptor)) {
      throw new TypeError(`MDX global ${JSON.stringify(key)} must be a data property`);
    }
    if (key === MDX_METADATA_EXPORT_NAME) {
      throw new TypeError(`MDX global binding name ${JSON.stringify(key)} is reserved`);
    }
    if (typeof descriptor.value !== "string") {
      throw new TypeError(`MDX global ${JSON.stringify(key)} must be a string`);
    }
    entries.push([key, descriptor.value]);
  }

  return Object.fromEntries(
    entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
  );
}

function splitPathSuffix(importPath: string): { path: string; suffix: string } {
  const queryIndex = importPath.indexOf("?");
  const fragmentIndex = importPath.indexOf("#");
  const suffixIndex = queryIndex === -1
    ? fragmentIndex
    : fragmentIndex === -1
    ? queryIndex
    : Math.min(queryIndex, fragmentIndex);
  return suffixIndex === -1
    ? { path: importPath, suffix: "" }
    : { path: importPath.slice(0, suffixIndex), suffix: importPath.slice(suffixIndex) };
}

function toMdxOutputPath(sourcePath: string): string {
  if (!sourcePath.endsWith(".mdx")) {
    throw new TypeError(`MDX source path must end with ".mdx": ${sourcePath}`);
  }
  return `${sourcePath.slice(0, -".mdx".length)}.js`;
}

function toLocalImportPath(
  importPath: string,
  sourcePath: string,
  projectDir: string,
): { path: string; suffix: string } | null {
  if (importPath.startsWith("file:")) {
    try {
      const url = new URL(importPath);
      if (url.protocol !== "file:") return null;
      const suffix = `${url.search}${url.hash}`;
      url.search = "";
      url.hash = "";
      return { path: fromFileUrl(url), suffix };
    } catch (error) {
      throw MODULE_NOT_FOUND.create({
        detail: `Cannot resolve malformed local module URL from '${sourcePath}'`,
        cause: ensureError(error),
      });
    }
  }

  const localSpecifier = splitPathSuffix(importPath);
  if (localSpecifier.path.startsWith("/")) {
    return {
      path: join(projectDir, localSpecifier.path),
      suffix: localSpecifier.suffix,
    };
  }
  if (isAbsolute(localSpecifier.path)) return localSpecifier;
  if (localSpecifier.path.startsWith(".")) {
    return {
      path: resolve(dirname(sourcePath), localSpecifier.path),
      suffix: localSpecifier.suffix,
    };
  }
  return null;
}

function assertProjectContainment(
  candidatePath: string,
  projectDir: string,
  sourcePath: string,
): void {
  if (isWithinDirectory(resolve(projectDir), resolve(candidatePath))) return;

  throw SECURITY_VIOLATION.create({
    detail: `Local MDX import from '${sourcePath}' resolves outside the project directory`,
  });
}

async function resolveLocalImport(
  importPath: string,
  sourcePath: string,
  projectDir: string,
  authoredSpecifier: string,
  getCanonicalProjectDir: () => Promise<string> = () => realPath(projectDir),
): Promise<ResolvedLocalImport | null> {
  const localSpecifier = toLocalImportPath(importPath, sourcePath, projectDir);
  if (localSpecifier === null) return null;
  const basePath = localSpecifier.path;

  assertProjectContainment(basePath, projectDir, sourcePath);

  const inferredSuffixes = LOCAL_IMPORT_SUFFIXES.slice(1);
  const hasExplicitModuleSuffix = inferredSuffixes.some((suffix) => basePath.endsWith(suffix));
  const candidates = hasExplicitModuleSuffix ? [basePath] : [
    basePath,
    ...inferredSuffixes.map((suffix) => `${basePath}${suffix}`),
    ...inferredSuffixes.map((suffix) => join(basePath, `index${suffix}`)),
  ];

  for (const candidatePath of candidates) {
    assertProjectContainment(candidatePath, projectDir, sourcePath);
    try {
      const stat = await fs.stat(candidatePath);
      if (!stat.isFile) continue;

      const [canonicalProjectDir, canonicalCandidate] = await Promise.all([
        getCanonicalProjectDir(),
        realPath(candidatePath),
      ]);
      if (!isWithinDirectory(canonicalProjectDir, canonicalCandidate)) {
        throw SECURITY_VIOLATION.create({
          detail: `Local MDX import from '${sourcePath}' resolves outside the project directory`,
        });
      }

      return {
        path: candidatePath,
        readPath: canonicalCandidate,
        suffix: localSpecifier.suffix,
      };
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      /* expected: this candidate may not exist */
    }
  }

  throw MODULE_NOT_FOUND.create({
    detail: `Cannot find module '${authoredSpecifier}' from '${sourcePath}'`,
  });
}

function toAuthoredSpecifier(
  importPath: string,
  sourcePath: string,
  projectDir: string,
): string {
  const localSpecifier = toLocalImportPath(importPath, sourcePath, projectDir);
  if (localSpecifier === null) return importPath;

  const relativePath = relative(dirname(sourcePath), localSpecifier.path);
  const authoredPath = relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
  return `${authoredPath}${localSpecifier.suffix}`;
}

function getCanonicalProjectDir(state: MdxModuleGraphState): Promise<string> {
  return state.canonicalProjectDir ??= realPath(state.options.projectDir);
}

async function compileNestedMdxImport(
  localImport: ResolvedLocalImport,
  outputPath: string,
  state: MdxModuleGraphState,
): Promise<void> {
  if (
    outputPath === state.rootOutputPath ||
    state.outputs.has(outputPath) ||
    state.activeOutputs.has(outputPath)
  ) {
    return;
  }

  state.activeOutputs.add(outputPath);
  try {
    const importContent = await fs.readTextFile(localImport.readPath);
    const compiledImport = await state.compileImport(
      importContent,
      state.options,
      localImport.path,
    );
    const rewrittenImport = await rewriteLocalModuleImports(
      compiledImport,
      localImport.path,
      state,
    );
    state.outputs.set(outputPath, {
      path: outputPath,
      content: rewrittenImport,
      type: "js",
    });
    state.dependencies.set(
      localImport.path,
      await getModuleDependencies(rewrittenImport),
    );
  } finally {
    state.activeOutputs.delete(outputPath);
  }
}

async function rewriteLocalModuleImports(
  code: string,
  sourcePath: string,
  state: MdxModuleGraphState,
): Promise<string> {
  const replacements = new Map<string, string>();
  for (const moduleImport of await parseModuleImports(code)) {
    const localImport = await resolveLocalImport(
      moduleImport.specifier,
      sourcePath,
      state.options.projectDir,
      toAuthoredSpecifier(
        moduleImport.specifier,
        sourcePath,
        state.options.projectDir,
      ),
      () => getCanonicalProjectDir(state),
    );
    if (localImport === null) continue;
    if (!localImport.path.endsWith(".mdx")) {
      replacements.set(
        moduleImport.specifier,
        `${toFileUrl(localImport.readPath).href}${localImport.suffix}`,
      );
      continue;
    }

    const outputPath = toMdxOutputPath(localImport.path);
    await compileNestedMdxImport(localImport, outputPath, state);
    replacements.set(
      moduleImport.specifier,
      `${toFileUrl(outputPath).href}${localImport.suffix}`,
    );
  }
  return await replaceModuleImportSpecifiers(code, replacements);
}

async function buildLocalMdxModuleGraph(
  code: string,
  sourcePath: string,
  rootOutputPath: string,
  options: BundlerOptions,
  compileImport: CompileMdxImport,
): Promise<{
  code: string;
  outputs: Map<string, StagedMdxOutput>;
  dependencies: Map<string, string[]>;
}> {
  const state: MdxModuleGraphState = {
    options,
    rootOutputPath,
    compileImport,
    outputs: new Map(),
    dependencies: new Map(),
    activeOutputs: new Set(),
  };
  return {
    code: await rewriteLocalModuleImports(code, sourcePath, state),
    outputs: state.outputs,
    dependencies: state.dependencies,
  };
}

async function rewriteStandaloneLocalImports(
  code: string,
  sourcePath: string,
  projectDir: string,
): Promise<string> {
  const replacements = new Map<string, string>();
  let canonicalProjectDir: Promise<string> | undefined;
  const getProjectDir = () => canonicalProjectDir ??= realPath(projectDir);

  for (const moduleImport of await parseModuleImports(code)) {
    const localImport = await resolveLocalImport(
      moduleImport.specifier,
      sourcePath,
      projectDir,
      toAuthoredSpecifier(moduleImport.specifier, sourcePath, projectDir),
      getProjectDir,
    );
    if (localImport === null) continue;
    if (localImport.path.endsWith(".mdx")) {
      throw new TypeError(
        "bundleMDXWithOptions cannot emit imported MDX modules; use bundleMdx for an output graph",
      );
    }
    replacements.set(
      moduleImport.specifier,
      `${toFileUrl(localImport.readPath).href}${localImport.suffix}`,
    );
  }

  return await replaceModuleImportSpecifiers(code, replacements);
}

/**
 * Bundle MDX content
 */
export function bundleMdx(
  source: { path: string; content: string },
  options: BundlerOptions,
  result: BundleResult,
  compileMDXForImport: CompileMdxImport,
): Promise<void> {
  return withSpan(
    "build.renderer.bundleMDX",
    async () => {
      try {
        const processor = resolveContract<ContentProcessor>("ContentProcessor");
        const { body, frontmatter } = processor.extractFrontmatter({
          content: source.content,
          syntax: "mdx",
        });
        const projectSource = resolveProjectSourcePath(source.path, options.projectDir);
        const outputPath = toMdxOutputPath(source.path);
        const absoluteOutputPath = toMdxOutputPath(projectSource.absolutePath);
        const slug = getSlugFromPath(projectSource.relativePath);
        const meta = {
          slug,
          title: frontmatter.title ?? slug,
          description: frontmatter.description ?? "",
          ...frontmatter,
        };

        const compiled = await processor.compileMdx({
          projectDir: options.projectDir,
          content: body,
          frontmatter,
          filePath: projectSource.absolutePath,
          mode: options.mode,
          target: "server",
          outputFormat: "program",
          providerImportSource: MDX_PROVIDER_IMPORT_SOURCE,
          moduleValues: {
            exports: { [MDX_METADATA_EXPORT_NAME]: meta },
          },
        });

        const moduleGraph = await buildLocalMdxModuleGraph(
          compiled.compiledCode,
          projectSource.absolutePath,
          absoluteOutputPath,
          options,
          compileMDXForImport,
        );

        for (const [nestedOutputPath, nestedOutput] of moduleGraph.outputs) {
          result.outputs.set(nestedOutputPath, nestedOutput);
        }
        result.outputs.set(outputPath, {
          path: outputPath,
          content: moduleGraph.code,
          type: "js",
          meta: frontmatter,
        });

        for (const [nestedSourcePath, dependencies] of moduleGraph.dependencies) {
          result.dependencies.set(nestedSourcePath, dependencies);
        }
        result.dependencies.set(
          source.path,
          await getModuleDependencies(moduleGraph.code),
        );

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
        const projectSource = resolveProjectSourcePath(filePath, options.projectDir);
        const processor = resolveContract<ContentProcessor>("ContentProcessor");
        const { body, frontmatter } = processor.extractFrontmatter({
          content,
          syntax: "mdx",
        });
        const compiled = await processor.compileMdx({
          projectDir: options.projectDir,
          content: body,
          frontmatter,
          filePath: projectSource.absolutePath,
          mode,
          target: "server",
          outputFormat: "program",
          providerImportSource: MDX_PROVIDER_IMPORT_SOURCE,
          moduleValues: {
            bindings: createGlobalBindings(globals),
            exports: { [MDX_METADATA_EXPORT_NAME]: frontmatter },
          },
          remarkPlugins: normalizePlugins(remarkPlugins as ContentPlugin[]),
          rehypePlugins: normalizePlugins(rehypePlugins as ContentPlugin[]),
        });

        const code = await rewriteStandaloneLocalImports(
          compiled.compiledCode,
          projectSource.absolutePath,
          options.projectDir,
        );

        return {
          code,
          frontmatter,
          dependencies: await getModuleDependencies(code),
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
