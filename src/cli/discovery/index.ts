import { detectPlatform, type Platform } from "../../platform/core-platform.ts";
import type { Plugin, PluginBuild } from "esbuild";
import { registerPrompt, registerResource, registerTool } from "#veryfront/mcp";
import type { Tool } from "#veryfront/tool";
import type { Prompt } from "#veryfront/prompt";
import type { Resource } from "#veryfront/resource";
import type { Agent } from "#veryfront/agent";
import { registerAgent } from "#veryfront/agent";
import { registerWorkflow } from "#veryfront/workflow";
import type { Workflow } from "#veryfront/workflow";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/platform/compat/path-helper.ts";
import { getEsbuildLoader } from "#veryfront/utils/path-utils.ts";
import { ensureError } from "#veryfront/errors/veryfront-error.ts";

interface FileDiscoveryContext {
  platform: Platform;
  fsAdapter?: FileSystemAdapter;
  nodeDeps?: {
    fs: typeof import("node:fs");
    path: typeof import("node:path");
  };
  baseDir?: string;
}

const transpileCache = new Map<string, unknown>();

function createFsAdapterPlugin(fsAdapter: FileSystemAdapter): Plugin {
  const existsCache = new Map<string, boolean>();

  async function checkExists(filePath: string): Promise<boolean> {
    const cached = existsCache.get(filePath);
    if (cached !== undefined) return cached;

    const exists = await fsAdapter.exists(filePath);
    existsCache.set(filePath, exists);
    return exists;
  }

  async function resolveWithExtensions(basePath: string): Promise<string | null> {
    if (/\.(ts|tsx|js|jsx|mjs|json)$/i.test(basePath)) {
      return (await checkExists(basePath)) ? basePath : null;
    }

    const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

    for (const ext of extensions) {
      const fullPath = basePath + ext;
      if (await checkExists(fullPath)) return fullPath;
    }

    for (const ext of extensions) {
      const indexPath = pathHelper.join(basePath, `index${ext}`);
      if (await checkExists(indexPath)) return indexPath;
    }

    return null;
  }

  return {
    name: "veryfront-fsadapter",
    setup(build: PluginBuild) {
      build.onResolve({ filter: /^\.\.?\// }, async (args) => {
        const importerDir = args.importer ? pathHelper.dirname(args.importer) : args.resolveDir;
        const basePath = pathHelper.resolve(importerDir, args.path);

        const resolvedPath = await resolveWithExtensions(basePath);
        if (resolvedPath) {
          return { path: resolvedPath, namespace: "fsadapter" };
        }

        return {
          errors: [{
            text: `Could not resolve "${args.path}" from "${importerDir}" via fsAdapter`,
          }],
        };
      });

      build.onLoad({ filter: /.*/, namespace: "fsadapter" }, async (args) => {
        try {
          const content = await fsAdapter.readFile(args.path);
          return {
            contents: content,
            loader: getEsbuildLoader(args.path),
            resolveDir: pathHelper.dirname(args.path),
          };
        } catch (error) {
          return {
            errors: [{
              text: `Failed to load "${args.path}" from fsAdapter: ${error}`,
            }],
          };
        }
      });
    },
  };
}

async function importModule(file: string, context: FileDiscoveryContext): Promise<unknown> {
  if (transpileCache.has(file)) return transpileCache.get(file);

  const filePath = file.replace("file://", "");

  let source: string;
  try {
    if (context.fsAdapter) {
      source = await context.fsAdapter.readFile(filePath);
    } else {
      source = await createFileSystem().readTextFile(filePath);
    }
  } catch (error) {
    throw new Error(`Failed to read file ${filePath}: ${error}`);
  }

  const loader = getEsbuildLoader(filePath);
  const { build } = await import("esbuild");
  const fileDir = pathHelper.dirname(filePath);

  const relativeImports = isDeno
    ? [...source.matchAll(/from\s+["'](\.\.[^"']+)["']/g)].map((m) => m[1]!).filter(Boolean)
    : [];

  const plugins = !isDeno && context.fsAdapter ? [createFsAdapterPlugin(context.fsAdapter)] : [];

  const result = await build({
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    jsx: "automatic",
    jsxImportSource: "react",
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
    plugins,
    external: [
      "ai",
      "ai/*",
      "@ai-sdk/*",
      "zod",
      "node:*",
      "veryfront",
      "veryfront/*",
      "@opentelemetry/*",
      "path",
      ...relativeImports,
    ],
    stdin: {
      contents: source,
      loader,
      resolveDir: fileDir,
      sourcefile: filePath,
    },
  });

  if (result.errors?.length) {
    throw new Error(
      `Failed to transpile ${filePath}: ${result.errors[0]?.text || "unknown error"}`,
    );
  }

  const js = result.outputFiles?.[0]?.text ?? "export {}";

  const localFs = createFileSystem();
  const tempDir = await localFs.makeTempDir({ prefix: "vf-discovery-" });
  const tempFile = pathHelper.join(tempDir, "module.mjs");

  const transformedCode = isDeno
    ? rewriteForDeno(js, fileDir)
    : await rewriteDiscoveryImports(js, context.baseDir ?? ".", localFs, fileDir);

  await localFs.writeTextFile(tempFile, transformedCode);

  try {
    const module = await import(`file://${tempFile}?v=${Date.now()}`);
    transpileCache.set(file, module);
    return module;
  } finally {
    await localFs.remove(tempDir, { recursive: true });
  }
}

function rewriteForDeno(code: string, fileDir: string): string {
  const npmReplacements: Array<[RegExp, string]> = [
    [/from\s+["']ai["']/g, 'from "npm:ai"'],
    [/from\s+["']ai\/([^"']+)["']/g, 'from "npm:ai/$1"'],
    [/from\s+["']@ai-sdk\/([^"']+)["']/g, 'from "npm:@ai-sdk/$1"'],
    [/from\s+["']zod["']/g, 'from "npm:zod"'],
    [/import\s*\(\s*["']ai["']\s*\)/g, 'import("npm:ai")'],
    [/import\s*\(\s*["']zod["']\s*\)/g, 'import("npm:zod")'],
  ];

  let transformed = code;
  for (const [pattern, replacement] of npmReplacements) {
    transformed = transformed.replace(pattern, replacement);
  }

  return transformed.replace(
    /from\s+["'](\.\.\/[^"']+)["']/g,
    (_match, relativePath: string) => `from "file://${pathHelper.resolve(fileDir, relativePath)}"`,
  );
}

async function rewriteDiscoveryImports(
  code: string,
  projectDir: string,
  fs: ReturnType<typeof createFileSystem>,
  fileDir: string,
): Promise<string> {
  let transformed = code;

  try {
    const { pathToFileURL } = await import("node:url");

    transformed = transformed.replace(
      /from\s+["'](\.\.\/[^"']+)["']/g,
      (_match, relativePath: string) =>
        `from "${pathToFileURL(pathHelper.resolve(fileDir, relativePath)).href}"`,
    );

    const resolvePackageToFileUrl = async (packageName: string): Promise<string | null> => {
      let searchDir = projectDir;

      for (let i = 0; i < 10; i++) {
        const packagePath = pathHelper.join(searchDir, "node_modules", packageName);
        const packageJsonPath = pathHelper.join(packagePath, "package.json");

        try {
          const pkgJson = JSON.parse(await fs.readTextFile(packageJsonPath));
          const dotExport = pkgJson.exports?.["."];
          const entryPoint =
            (typeof dotExport === "string" ? dotExport : dotExport?.import ?? dotExport?.default) ??
              pkgJson.module ??
              pkgJson.main ??
              "index.js";

          return pathToFileURL(pathHelper.join(packagePath, entryPoint)).href;
        } catch {
          const parent = pathHelper.dirname(searchDir);
          if (parent === searchDir) break;
          searchDir = parent;
        }
      }

      return null;
    };

    const rewritePackageImports = async (input: string, pkg: string): Promise<string> => {
      const escapedPkg = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const staticImportRegex = new RegExp(`from\\s*["']${escapedPkg}["']`, "g");
      const dynamicImportRegex = new RegExp(`import\\s*\\(\\s*["']${escapedPkg}["']\\s*\\)`, "g");

      if (!staticImportRegex.test(input) && !dynamicImportRegex.test(input)) return input;

      const resolvedUrl = await resolvePackageToFileUrl(pkg);
      if (!resolvedUrl) return input;

      return input
        .replace(staticImportRegex, `from "${resolvedUrl}"`)
        .replace(dynamicImportRegex, `import("${resolvedUrl}")`);
    };

    const externalPackages = [
      "zod",
      "ai",
      "@ai-sdk/anthropic",
      "@ai-sdk/openai",
      "@ai-sdk/google",
      "@ai-sdk/mistral",
      "@ai-sdk/provider",
      "@ai-sdk/provider-utils",
    ];

    for (const pkg of externalPackages) {
      transformed = await rewritePackageImports(transformed, pkg);
    }

    let vfPackagePath = pathHelper.join(projectDir, "node_modules", "veryfront");
    let exportsMap: Record<string, string | { import?: string }> = {};

    try {
      const vfPackageJsonPath = pathHelper.join(vfPackagePath, "package.json");
      const pkgJson = JSON.parse(await fs.readTextFile(vfPackageJsonPath));
      exportsMap = pkgJson.exports || {};
    } catch {
      let searchDir = projectDir;

      for (let i = 0; i < 5; i++) {
        try {
          const denoJsonPath = pathHelper.join(searchDir, "deno.json");
          const denoJson = JSON.parse(await fs.readTextFile(denoJsonPath));
          if (denoJson.name === "veryfront" && denoJson.exports) {
            exportsMap = denoJson.exports;
            vfPackagePath = searchDir;
            break;
          }
        } catch {
          // continue searching
        }
        searchDir = pathHelper.dirname(searchDir);
      }
    }

    const getExportPath = (entry: string | { import?: string } | undefined): string | null => {
      if (!entry) return null;
      if (typeof entry === "string") return entry;
      return entry.import ?? null;
    };

    transformed = transformed.replace(
      /from\s+["'](veryfront\/[^"']+)["']/g,
      (match, fullSpecifier: string) => {
        const subpath = "./" + fullSpecifier.replace("veryfront/", "");
        const exportPath = getExportPath(exportsMap[subpath]);
        if (!exportPath) return match;

        const resolvedPath = pathHelper.join(vfPackagePath, exportPath);
        return `from "${pathToFileURL(resolvedPath).href}"`;
      },
    );

    transformed = transformed.replace(/from\s+["']veryfront["']/g, () => {
      const exportPath = getExportPath(exportsMap["."]);
      if (!exportPath) return 'from "veryfront"';

      const resolvedPath = pathHelper.join(vfPackagePath, exportPath);
      return `from "${pathToFileURL(resolvedPath).href}"`;
    });
  } catch {
    return transformed;
  }

  return transformed;
}

export interface DiscoveryConfig {
  baseDir: string;
  toolDirs?: string[];
  agentDirs?: string[];
  resourceDirs?: string[];
  promptDirs?: string[];
  workflowDirs?: string[];
  verbose?: boolean;
  fsAdapter?: FileSystemAdapter;
}

export interface DiscoveryResult {
  tools: Map<string, Tool>;
  agents: Map<string, Agent>;
  resources: Map<string, Resource>;
  prompts: Map<string, Prompt>;
  workflows: Map<string, Workflow>;
  errors: Array<{ file: string; error: Error }>;
}

export async function discoverAll(config: DiscoveryConfig): Promise<DiscoveryResult> {
  const baseDir = config.baseDir;

  const context: FileDiscoveryContext = {
    platform: detectPlatform(),
    fsAdapter: config.fsAdapter,
    baseDir,
  };

  const result: DiscoveryResult = {
    tools: new Map(),
    agents: new Map(),
    resources: new Map(),
    prompts: new Map(),
    workflows: new Map(),
    errors: [],
  };

  for (const dir of config.toolDirs ?? ["tools"]) {
    await discoverTools(`${baseDir}/${dir}`, result, context, config.verbose);
  }

  for (const dir of config.agentDirs ?? ["agents"]) {
    await discoverAgents(`${baseDir}/${dir}`, result, context, config.verbose);
  }

  for (const dir of config.resourceDirs ?? ["resources"]) {
    await discoverResources(`${baseDir}/${dir}`, result, context, config.verbose);
  }

  for (const dir of config.promptDirs ?? ["prompts"]) {
    await discoverPrompts(`${baseDir}/${dir}`, result, context, config.verbose);
  }

  for (const dir of config.workflowDirs ?? ["workflows"]) {
    await discoverWorkflows(`${baseDir}/${dir}`, result, context, config.verbose);
  }

  return result;
}

interface DiscoveryHandler<T> {
  typeName: string;
  validate: (item: unknown) => item is T;
  getId: (item: T, file: string, dir: string) => string;
  register: (id: string, item: T, file: string, dir: string) => T;
  getResultMap: (result: DiscoveryResult) => Map<string, T>;
}

async function discoverItems<T>(
  dir: string,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
  handler: DiscoveryHandler<T>,
  verbose?: boolean,
): Promise<void> {
  const files = await findTypeScriptFiles(dir, context);

  if (verbose) {
    agentLogger.info(`[Discovery] Found ${files.length} ${handler.typeName} files in ${dir}`);
  }

  for (const file of files) {
    try {
      const module = await importModule(file, context);
      const item = (module as { default?: T }).default;

      if (!handler.validate(item)) {
        if (verbose) {
          agentLogger.warn(`[Discovery] ${file} does not export a valid ${handler.typeName}`);
        }
        continue;
      }

      const id = handler.getId(item, file, dir);
      const registered = handler.register(id, item, file, dir);
      handler.getResultMap(result).set(id, registered);

      if (verbose) {
        agentLogger.info(`[Discovery] Registered ${handler.typeName}: ${id}`);
      }
    } catch (error) {
      result.errors.push({ file, error: ensureError(error) });

      if (verbose) {
        agentLogger.error(`[Discovery] Error loading ${file}:`, error);
      }
    }
  }
}

const toolHandler: DiscoveryHandler<Tool> = {
  typeName: "tool",
  validate: (item): item is Tool =>
    item !== null && typeof item === "object" && typeof (item as Tool).execute === "function",
  getId: (_item, file) => filenameToId(file),
  register: (id, tool) => {
    const toolWithId = { ...tool, id };
    registerTool(id, toolWithId);
    return toolWithId;
  },
  getResultMap: (result) => result.tools,
};

const agentHandler: DiscoveryHandler<Agent> = {
  typeName: "agent",
  validate: (item): item is Agent =>
    item !== null && typeof item === "object" && typeof (item as Agent).generate === "function",
  getId: (agent, file) => agent.id || filenameToId(file),
  register: (id, agent, file) => {
    registerAgent(id, agent);
    trackAgentPath(id, file);
    return agent;
  },
  getResultMap: (result) => result.agents,
};

const resourceHandler: DiscoveryHandler<Resource> = {
  typeName: "resource",
  validate: (item): item is Resource =>
    item !== null && typeof item === "object" && typeof (item as Resource).load === "function",
  getId: (_item, file) => filenameToId(file),
  register: (id, resource, file, dir) => {
    const pattern = filePathToPattern(file, dir);
    const resourceWithMeta = { ...resource, id, pattern };
    registerResource(id, resourceWithMeta);
    return resourceWithMeta;
  },
  getResultMap: (result) => result.resources,
};

const promptHandler: DiscoveryHandler<Prompt> = {
  typeName: "prompt",
  validate: (item): item is Prompt =>
    item !== null && typeof item === "object" && typeof (item as Prompt).getContent === "function",
  getId: (_item, file) => filenameToId(file),
  register: (id, prompt) => {
    const promptWithId = { ...prompt, id };
    registerPrompt(id, promptWithId);
    return promptWithId;
  },
  getResultMap: (result) => result.prompts,
};

const workflowHandler: DiscoveryHandler<Workflow> = {
  typeName: "workflow",
  validate: (item): item is Workflow =>
    item !== null &&
    typeof item === "object" &&
    "definition" in item &&
    "id" in item &&
    typeof (item as Workflow).id === "string",
  getId: (workflow) => workflow.id,
  register: (_id, workflow) => {
    registerWorkflow(workflow);
    return workflow;
  },
  getResultMap: (result) => result.workflows,
};

function discoverTools(
  dir: string,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
  verbose?: boolean,
): Promise<void> {
  return discoverItems(dir, result, context, toolHandler, verbose);
}

function discoverAgents(
  dir: string,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
  verbose?: boolean,
): Promise<void> {
  return discoverItems(dir, result, context, agentHandler, verbose);
}

function discoverResources(
  dir: string,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
  verbose?: boolean,
): Promise<void> {
  return discoverItems(dir, result, context, resourceHandler, verbose);
}

function discoverPrompts(
  dir: string,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
  verbose?: boolean,
): Promise<void> {
  return discoverItems(dir, result, context, promptHandler, verbose);
}

function discoverWorkflows(
  dir: string,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
  verbose?: boolean,
): Promise<void> {
  return discoverItems(dir, result, context, workflowHandler, verbose);
}

async function findTypeScriptFiles(dir: string, context: FileDiscoveryContext): Promise<string[]> {
  const files: string[] = [];

  try {
    if (context.fsAdapter) {
      if (!(await context.fsAdapter.exists(dir))) return files;

      for await (const entry of context.fsAdapter.readDir(dir)) {
        const filePath = `${dir}/${entry.name}`;

        if (entry.isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
          files.push(`file://${filePath}`);
          continue;
        }

        if (entry.isDirectory) {
          files.push(...await findTypeScriptFiles(filePath, context));
        }
      }

      return files;
    }

    const { fs, path } = await getNodeDeps(context);
    if (!fs.existsSync(dir)) return files;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name);

      if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
        files.push(`file://${path.resolve(filePath)}`);
        continue;
      }

      if (entry.isDirectory()) {
        files.push(...await findTypeScriptFiles(filePath, context));
      }
    }
  } catch {
    return files;
  }

  return files;
}

async function getNodeDeps(
  context: FileDiscoveryContext,
): Promise<{ fs: typeof import("node:fs"); path: typeof import("node:path") }> {
  if (context.nodeDeps) return context.nodeDeps;

  if (context.fsAdapter) {
    context.nodeDeps = {
      fs: {} as typeof import("node:fs"),
      path: {} as typeof import("node:path"),
    };
    return context.nodeDeps;
  }

  const [fsModule, pathModule] = await Promise.all([import("node:fs"), import("node:path")]);
  context.nodeDeps = { fs: fsModule, path: pathModule };
  return context.nodeDeps;
}

function filenameToId(filePath: string): string {
  const filename = filePath.split("/").pop()?.replace(/\.(ts|tsx|js|jsx)$/, "") ?? "";
  return filename
    .replace(/[-_](.)/g, (_, char) => char.toUpperCase())
    .replace(/^[A-Z]/, (char) => char.toLowerCase());
}

function filePathToPattern(filePath: string, baseDir: string): string {
  const cleanPath = filePath.replace("file://", "");

  let pattern = cleanPath.replace(baseDir, "").replace(/\.(ts|tsx|js|jsx)$/, "");
  pattern = pattern.replace(/\[(\w+)\]/g, ":$1").replace(/^\/+/, "");

  return "/" + pattern;
}

const discoveredAgentPaths = new Map<string, string>();

export async function generateAgentIndex(baseDir: string): Promise<void> {
  const generatedDir = `${baseDir}/.generated`;
  const indexPath = `${generatedDir}/agents.ts`;

  try {
    const [fsModule, pathModule] = await Promise.all([import("node:fs"), import("node:path")]);

    if (!fsModule.existsSync(generatedDir)) {
      fsModule.mkdirSync(generatedDir, { recursive: true });
    }

    const lines: string[] = [
      "/**",
      " * Auto-generated by veryfront",
      " * Do not edit manually - this file is regenerated on each dev server start",
      " */",
      "",
    ];

    for (const [id, filePath] of discoveredAgentPaths) {
      const cleanPath = filePath.replace("file://", "");
      const relativePath = pathModule.relative(generatedDir, cleanPath).replace(
        /\.(ts|tsx|js|jsx)$/,
        "",
      );
      lines.push(`export { default as ${id} } from '${relativePath}';`);
    }

    lines.push("");
    lines.push("// Runtime lookup object");

    const agentIds = Array.from(discoveredAgentPaths.keys());
    if (agentIds.length) {
      lines.push(`import { ${agentIds.join(", ")} } from './agents';`);
      lines.push("");
      lines.push("export const agents = {");
      for (const id of agentIds) lines.push(`  ${id},`);
      lines.push("} as const;");
    } else {
      lines.push("export const agents = {} as const;");
    }

    lines.push("");

    fsModule.writeFileSync(indexPath, lines.join("\n"));
    agentLogger.debug(`[Discovery] Generated agent index: ${indexPath}`);
  } catch (error) {
    agentLogger.debug(`[Discovery] Could not generate agent index: ${error}`);
  }
}

function trackAgentPath(id: string, filePath: string): void {
  discoveredAgentPaths.set(id, filePath);
}

export function clearTrackedAgents(): void {
  discoveredAgentPaths.clear();
}

export function clearTranspileCache(): void {
  transpileCache.clear();
}
