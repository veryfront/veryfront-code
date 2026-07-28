import { bundlerLogger as logger } from "#veryfront/utils";
import { dirname, fromFileUrl, relative, toFileUrl } from "#veryfront/compat/path/index.ts";
import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type { ContentPlugin, ContentProcessor } from "#veryfront/extensions/content/index.ts";
import { ensureError } from "#veryfront/errors";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  type ResolvedProjectModule,
  resolveProjectModule,
  resolveProjectSourcePath as resolveContainedProjectSourcePath,
} from "../../bundler/project-module-resolver.ts";
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

type ResolvedLocalImport = ResolvedProjectModule;

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
}

function resolveProjectSourcePath(
  sourcePath: string,
  projectDir: string,
): { absolutePath: string; relativePath: string } {
  const absolutePath = resolveContainedProjectSourcePath(
    sourcePath,
    projectDir,
    "MDX",
  );
  return { absolutePath, relativePath: relative(projectDir, absolutePath) };
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

function toMdxOutputPath(sourcePath: string): string {
  if (!sourcePath.toLowerCase().endsWith(".mdx")) {
    throw new TypeError(`MDX source path must end with ".mdx": ${sourcePath}`);
  }
  return `${sourcePath.slice(0, -".mdx".length)}.js`;
}

function assertMdxInput(
  content: string,
  mode: BundlerOptions["mode"],
): void {
  if (typeof content !== "string") {
    throw new TypeError("MDX source content must be a string");
  }
  if (mode !== "development" && mode !== "production") {
    throw new TypeError("MDX bundle mode must be development or production");
  }
}

function toAuthoredSpecifier(importPath: string, sourcePath: string): string {
  if (!importPath.startsWith("file:")) return importPath;

  try {
    const url = new URL(importPath);
    const suffix = `${url.search}${url.hash}`;
    url.search = "";
    url.hash = "";
    const relativePath = relative(dirname(sourcePath), fromFileUrl(url));
    const authoredPath = relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
    return `${authoredPath}${suffix}`;
  } catch {
    // Resolution below reports a structured error for malformed file URLs.
    return importPath;
  }
}

async function resolveLocalImport(
  importPath: string,
  sourcePath: string,
  projectDir: string,
): Promise<ResolvedLocalImport | null> {
  return await resolveProjectModule(
    importPath,
    dirname(sourcePath),
    projectDir,
    fs,
    "MDX",
    toAuthoredSpecifier(importPath, sourcePath),
  );
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

  for (const moduleImport of await parseModuleImports(code)) {
    const localImport = await resolveLocalImport(
      moduleImport.specifier,
      sourcePath,
      projectDir,
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
        assertMdxInput(source.content, options.mode);
        if (typeof compileMDXForImport !== "function") {
          throw new TypeError("MDX nested compiler must be a function");
        }
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
        const rootDependencies = await getModuleDependencies(moduleGraph.code);

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
          rootDependencies,
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
        assertMdxInput(content, mode);
        const projectSource = resolveProjectSourcePath(filePath, options.projectDir);
        toMdxOutputPath(projectSource.absolutePath);
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
