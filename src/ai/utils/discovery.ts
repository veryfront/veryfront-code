import { detectPlatform } from "../runtime/platform.ts";
import type { Platform } from "../runtime/platform.ts";
import { registerPrompt, registerResource, registerTool } from "../mcp/registry.ts";
import type { Tool } from "../types/tool.ts";
import type { Prompt, Resource } from "../types/mcp.ts";
import type { Agent } from "../types/agent.ts";
import { registerAgent } from "../agent/composition.ts";
import { agentLogger } from "../../core/utils/logger/logger.ts";
import { getConfig } from "../../core/config/loader.ts";
import { createMockAdapter } from "../../platform/adapters/mock.ts";
import type { FileSystemAdapter } from "../../platform/adapters/base.ts";
import { isDeno } from "../../platform/compat/runtime.ts";
import { createFileSystem } from "../../platform/compat/fs.ts";
import * as pathHelper from "../../platform/compat/path-helper.ts";
import { getEsbuildLoader } from "../../core/utils/path-utils.ts";
import { ensureError } from "../../core/errors/veryfront-error.ts";

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

function createFsAdapterPlugin(fsAdapter: FileSystemAdapter) {
  // Cache existence checks to avoid repeated remote calls
  const existsCache = new Map<string, boolean>();

  async function checkExists(filePath: string): Promise<boolean> {
    if (existsCache.has(filePath)) {
      return existsCache.get(filePath)!;
    }
    const exists = await fsAdapter.exists(filePath);
    existsCache.set(filePath, exists);
    return exists;
  }

  // Try to resolve a path with various extensions
  async function resolveWithExtensions(basePath: string): Promise<string | null> {
    // If path already has an extension, use it directly
    if (/\.(ts|tsx|js|jsx|mjs|json)$/i.test(basePath)) {
      if (await checkExists(basePath)) {
        return basePath;
      }
      return null;
    }

    // Try common TypeScript/JavaScript extensions
    const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs"];
    for (const ext of extensions) {
      const fullPath = basePath + ext;
      if (await checkExists(fullPath)) {
        return fullPath;
      }
    }

    // Try index files (for directory imports)
    for (const ext of extensions) {
      const indexPath = pathHelper.join(basePath, `index${ext}`);
      if (await checkExists(indexPath)) {
        return indexPath;
      }
    }

    return null;
  }

  return {
    name: "veryfront-fsadapter",
    // deno-lint-ignore no-explicit-any
    setup(build: any) {
      // Intercept relative imports (./foo or ../foo)
      build.onResolve(
        { filter: /^\.\.?\// },
        async (args: { path: string; importer: string; resolveDir: string }) => {
          // Resolve path relative to importer's directory
          const importerDir = args.importer ? pathHelper.dirname(args.importer) : args.resolveDir;
          const basePath = pathHelper.resolve(importerDir, args.path);

          // Try to find the file with various extensions
          const resolvedPath = await resolveWithExtensions(basePath);
          if (resolvedPath) {
            return {
              path: resolvedPath,
              namespace: "fsadapter",
            };
          }

          // File not found - return error
          return {
            errors: [{
              text: `Could not resolve "${args.path}" from "${importerDir}" via fsAdapter`,
            }],
          };
        },
      );

      // Load files from fsAdapter
      build.onLoad(
        { filter: /.*/, namespace: "fsadapter" },
        async (args: { path: string }) => {
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
        },
      );
    },
  };
}

async function importModule(
  file: string,
  context: FileDiscoveryContext,
): Promise<unknown> {
  // Check cache first
  const cacheKey = file;
  if (transpileCache.has(cacheKey)) {
    return transpileCache.get(cacheKey);
  }

  const filePath = file.replace("file://", "");

  // Read the source file - use fsAdapter if available (Veryfront Cloud), otherwise local fs
  let source: string;
  try {
    if (context.fsAdapter) {
      source = await context.fsAdapter.readFile(filePath);
    } else {
      const fs = createFileSystem();
      source = await fs.readTextFile(filePath);
    }
  } catch (error) {
    throw new Error(`Failed to read file ${filePath}: ${error}`);
  }

  const loader = getEsbuildLoader(filePath);

  // Transpile with esbuild
  const { build } = await import("esbuild");

  // Get the directory containing the file for resolving relative imports
  const fileDir = pathHelper.dirname(filePath);

  // In Deno, esbuild runs as WASM which doesn't support plugins.
  // We mark relative imports as external and let Deno's native TS support handle them.
  const relativeImports: string[] = [];
  if (isDeno) {
    const relativeImportPattern = /from\s+["'](\.\.[^"']+)["']/g;
    let match;
    while ((match = relativeImportPattern.exec(source)) !== null) {
      if (match[1]) {
        relativeImports.push(match[1]);
      }
    }
  }

  // In Node.js with fsAdapter, use plugin to load relative imports from remote storage.
  // This properly bundles all dependencies instead of marking them external.
  const usePlugin = !isDeno && !!context.fsAdapter;
  const plugins = usePlugin ? [createFsAdapterPlugin(context.fsAdapter!)] : [];

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
      // Only mark relative imports as external in Deno (plugin handles them in Node.js)
      ...relativeImports,
    ],
    stdin: {
      contents: source,
      loader,
      resolveDir: fileDir,
      sourcefile: filePath,
    },
  });

  if (result.errors && result.errors.length > 0) {
    const first = result.errors[0]?.text || "unknown error";
    throw new Error(`Failed to transpile ${filePath}: ${first}`);
  }

  const js = result.outputFiles?.[0]?.text ?? "export {}";

  // Use local filesystem for temp files
  const localFs = createFileSystem();
  const tempDir = await localFs.makeTempDir({ prefix: "vf-discovery-" });
  const tempFile = pathHelper.join(tempDir, "module.mjs");

  // Rewrite package imports based on platform
  // - Deno: npm: specifiers + file:// for relative imports
  // - Node.js: resolve packages to file:// URLs from node_modules
  let transformedCode: string;
  if (isDeno) {
    transformedCode = rewriteForDeno(js, fileDir);
  } else {
    transformedCode = await rewriteDiscoveryImports(js, context.baseDir || ".", localFs, fileDir);
  }

  await localFs.writeTextFile(tempFile, transformedCode);

  try {
    const module = await import(`file://${tempFile}?v=${Date.now()}`);
    transpileCache.set(cacheKey, module);
    return module;
  } finally {
    await localFs.remove(tempDir, { recursive: true });
  }
}

function rewriteForDeno(code: string, fileDir: string): string {
  let transformed = code;

  // Rewrite external packages to npm: specifiers
  const npmPackages = [
    { pattern: /from\s+["']ai["']/g, replacement: 'from "npm:ai"' },
    { pattern: /from\s+["']ai\/([^"']+)["']/g, replacement: 'from "npm:ai/$1"' },
    { pattern: /from\s+["']@ai-sdk\/([^"']+)["']/g, replacement: 'from "npm:@ai-sdk/$1"' },
    { pattern: /from\s+["']zod["']/g, replacement: 'from "npm:zod"' },
    { pattern: /import\s*\(\s*["']ai["']\s*\)/g, replacement: 'import("npm:ai")' },
    { pattern: /import\s*\(\s*["']zod["']\s*\)/g, replacement: 'import("npm:zod")' },
  ];

  for (const { pattern, replacement } of npmPackages) {
    transformed = transformed.replace(pattern, replacement);
  }

  // Rewrite relative imports to absolute file:// URLs
  // This handles imports like "../../lib/github-client.ts" that were marked external
  transformed = transformed.replace(
    /from\s+["'](\.\.\/[^"']+)["']/g,
    (_match, relativePath: string) => {
      const absolutePath = pathHelper.resolve(fileDir, relativePath);
      return `from "file://${absolutePath}"`;
    },
  );

  return transformed;
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

    // Rewrite relative imports to absolute file:// URLs
    // This handles imports like "../../lib/github-client" that were marked external in Deno
    transformed = transformed.replace(
      /from\s+["'](\.\.\/[^"']+)["']/g,
      (_match, relativePath: string) => {
        const absolutePath = pathHelper.resolve(fileDir, relativePath);
        return `from "${pathToFileURL(absolutePath).href}"`;
      },
    );

    // Helper to resolve a package to absolute file:// URL
    const resolvePackageToFileUrl = async (packageName: string): Promise<string | null> => {
      const packagePath = pathHelper.join(projectDir, "node_modules", packageName);
      const packageJsonPath = pathHelper.join(packagePath, "package.json");

      try {
        const pkgJson = JSON.parse(await fs.readTextFile(packageJsonPath));
        let entryPoint: string | undefined;

        if (pkgJson.exports) {
          const dotExport = pkgJson.exports["."];
          if (typeof dotExport === "string") {
            entryPoint = dotExport;
          } else if (dotExport?.import) {
            entryPoint = dotExport.import;
          } else if (dotExport?.default) {
            entryPoint = dotExport.default;
          }
        }

        if (!entryPoint) {
          entryPoint = pkgJson.module || pkgJson.main || "index.js";
        }

        if (!entryPoint) {
          return null;
        }

        const resolvedPath = pathHelper.join(packagePath, entryPoint);
        return pathToFileURL(resolvedPath).href;
      } catch {
        return null;
      }
    };

    // List of external packages that need to be resolved
    const externalPackagesToResolve = [
      "zod",
      "ai",
      "@ai-sdk/anthropic",
      "@ai-sdk/openai",
      "@ai-sdk/google",
      "@ai-sdk/mistral",
      "@ai-sdk/provider",
      "@ai-sdk/provider-utils",
    ];

    for (const pkg of externalPackagesToResolve) {
      const escapedPkg = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      const staticImportRegex = new RegExp(`from\\s+["']${escapedPkg}["']`, "g");
      if (staticImportRegex.test(transformed)) {
        const resolvedUrl = await resolvePackageToFileUrl(pkg);
        if (resolvedUrl) {
          transformed = transformed.replace(staticImportRegex, `from "${resolvedUrl}"`);
        }
      }

      const dynamicImportRegex = new RegExp(`import\\s*\\(\\s*["']${escapedPkg}["']\\s*\\)`, "g");
      if (dynamicImportRegex.test(transformed)) {
        const resolvedUrl = await resolvePackageToFileUrl(pkg);
        if (resolvedUrl) {
          transformed = transformed.replace(dynamicImportRegex, `import("${resolvedUrl}")`);
        }
      }
    }

    // Resolve veryfront imports
    const vfPackagePath = pathHelper.join(projectDir, "node_modules", "veryfront");
    const vfPackageJsonPath = pathHelper.join(vfPackagePath, "package.json");

    let exportsMap: Record<string, { import?: string }> = {};
    try {
      const pkgJson = JSON.parse(await fs.readTextFile(vfPackageJsonPath));
      exportsMap = pkgJson.exports || {};
    } catch {
      // Ignore - veryfront may not be in node_modules
    }

    transformed = transformed.replace(
      /from\s+["'](veryfront\/[^"']+)["']/g,
      (_match, fullSpecifier: string) => {
        const subpath = "./" + fullSpecifier.replace("veryfront/", "");
        const exportEntry = exportsMap[subpath];
        if (exportEntry?.import) {
          const resolvedPath = pathHelper.join(vfPackagePath, exportEntry.import);
          return `from "${pathToFileURL(resolvedPath).href}"`;
        }
        return _match;
      },
    );

    transformed = transformed.replace(
      /from\s+["']veryfront["']/g,
      () => {
        const exportEntry = exportsMap["."];
        if (exportEntry?.import) {
          const resolvedPath = pathHelper.join(vfPackagePath, exportEntry.import);
          return `from "${pathToFileURL(resolvedPath).href}"`;
        }
        return 'from "veryfront"';
      },
    );
  } catch {
    // If node:url import fails, return code as-is
  }

  return transformed;
}

export interface DiscoveryConfig {
  baseDir: string;
  aiDir?: string;
  toolDirs?: string[];
  agentDirs?: string[];
  resourceDirs?: string[];
  promptDirs?: string[];
  verbose?: boolean;
  fsAdapter?: FileSystemAdapter;
}

export interface DiscoveryResult {
  tools: Map<string, Tool>;
  agents: Map<string, Agent>;
  resources: Map<string, Resource>;
  prompts: Map<string, Prompt>;
  errors: Array<{ file: string; error: Error }>;
}

export async function discoverAll(
  config: DiscoveryConfig,
): Promise<DiscoveryResult> {
  let aiDir = config.aiDir;
  const baseDir = config.baseDir;

  if (!aiDir) {
    try {
      const adapter = createMockAdapter();
      const projectConfig = await getConfig(baseDir, adapter);
      aiDir = projectConfig.directories?.ai || "ai";
    } catch {
      aiDir = "ai";
    }
  }

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
    errors: [],
  };

  const toolDirs = config.toolDirs || [`${aiDir}/tools`];
  for (const dir of toolDirs) {
    await discoverTools(`${baseDir}/${dir}`, result, context, config.verbose);
  }

  const agentDirs = config.agentDirs || [`${aiDir}/agents`];
  for (const dir of agentDirs) {
    await discoverAgents(`${baseDir}/${dir}`, result, context, config.verbose);
  }

  const resourceDirs = config.resourceDirs || [`${aiDir}/resources`];
  for (const dir of resourceDirs) {
    await discoverResources(`${baseDir}/${dir}`, result, context, config.verbose);
  }

  const promptDirs = config.promptDirs || [`${aiDir}/prompts`];
  for (const dir of promptDirs) {
    await discoverPrompts(`${baseDir}/${dir}`, result, context, config.verbose);
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
      const item = (module as { default?: T }).default as T;

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

async function findTypeScriptFiles(
  dir: string,
  context: FileDiscoveryContext,
): Promise<string[]> {
  const files: string[] = [];

  try {
    if (context.fsAdapter) {
      const exists = await context.fsAdapter.exists(dir);
      if (!exists) {
        return files;
      }

      for await (const entry of context.fsAdapter.readDir(dir)) {
        const filePath = `${dir}/${entry.name}`;

        if (entry.isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
          files.push(`file://${filePath}`);
        } else if (entry.isDirectory) {
          const subFiles = await findTypeScriptFiles(filePath, context);
          files.push(...subFiles);
        }
      }
    } else {
      const { fs, path } = await getNodeDeps(context);

      if (!fs || !path) {
        return files;
      }

      if (!fs.existsSync(dir)) {
        return files;
      }

      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const filePath = path.join(dir, entry.name);

        if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
          files.push(`file://${path.resolve(filePath)}`);
        } else if (entry.isDirectory()) {
          const subFiles = await findTypeScriptFiles(filePath, context);
          files.push(...subFiles);
        }
      }
    }
  } catch {
    // Directory doesn't exist or is not accessible
    return files;
  }

  return files;
}

async function getNodeDeps(context: FileDiscoveryContext) {
  if (context.nodeDeps) {
    return context.nodeDeps;
  }

  if (context.fsAdapter) {
    context.nodeDeps = {
      fs: {} as unknown as typeof import("node:fs"),
      path: {} as unknown as typeof import("node:path"),
    };
    return context.nodeDeps;
  }

  const [fsModule, pathModule] = await Promise.all([
    import("node:fs"),
    import("node:path"),
  ]);

  context.nodeDeps = {
    fs: fsModule,
    path: pathModule,
  };

  return context.nodeDeps;
}

function filenameToId(filePath: string): string {
  const filename = filePath.split("/").pop()?.replace(/\.(ts|tsx|js|jsx)$/, "") || "";

  return filename
    .replace(/[-_](.)/g, (_, char) => char.toUpperCase())
    .replace(/^[A-Z]/, (char) => char.toLowerCase());
}

function filePathToPattern(filePath: string, baseDir: string): string {
  const cleanPath = filePath.replace("file://", "");

  let pattern = cleanPath
    .replace(baseDir, "")
    .replace(/\.(ts|tsx|js|jsx)$/, "");

  pattern = pattern.replace(/\[(\w+)\]/g, ":$1");
  pattern = pattern.replace(/^\/+/, "");
  pattern = "/" + pattern;

  return pattern;
}

const discoveredAgentPaths = new Map<string, string>();

export async function generateAgentIndex(
  baseDir: string,
  aiDir: string = "ai",
): Promise<void> {
  const generatedDir = `${baseDir}/${aiDir}/.generated`;
  const indexPath = `${generatedDir}/agents.ts`;

  // Ensure the .generated directory exists
  try {
    const [fsModule, pathModule] = await Promise.all([
      import("node:fs"),
      import("node:path"),
    ]);

    if (!fsModule.existsSync(generatedDir)) {
      fsModule.mkdirSync(generatedDir, { recursive: true });
    }

    // Generate the index file content
    const lines: string[] = [
      "/**",
      " * Auto-generated by veryfront",
      " * Do not edit manually - this file is regenerated on each dev server start",
      " */",
      "",
    ];

    // Add exports for each discovered agent
    for (const [id, filePath] of discoveredAgentPaths) {
      // Convert absolute path to relative from .generated directory
      const cleanPath = filePath.replace("file://", "");
      const relativePath = pathModule.relative(generatedDir, cleanPath)
        .replace(/\.(ts|tsx|js|jsx)$/, "");

      lines.push(`export { default as ${id} } from '${relativePath}';`);
    }

    // Add an agents object for runtime lookup
    lines.push("");
    lines.push("// Runtime lookup object");
    const agentIds = Array.from(discoveredAgentPaths.keys());
    if (agentIds.length > 0) {
      lines.push(`import { ${agentIds.join(", ")} } from './agents';`);
      lines.push("");
      lines.push("export const agents = {");
      for (const id of agentIds) {
        lines.push(`  ${id},`);
      }
      lines.push("} as const;");
    } else {
      lines.push("export const agents = {} as const;");
    }

    lines.push("");

    // Write the file
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
