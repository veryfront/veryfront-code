/**
 * Auto-discovery system for AI components
 *
 * Scans ai/ directories and automatically registers:
 * - Tools (ai/tools/)
 * - Agents (ai/agents/)
 * - Resources (ai/resources/)
 * - Prompts (ai/prompts/)
 */

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

interface FileDiscoveryContext {
  platform: Platform;
  /** Optional filesystem adapter for cross-platform support */
  fsAdapter?: FileSystemAdapter;
  /** Cached node dependencies (lazy loaded) */
  nodeDeps?: {
    fs: typeof import("node:fs");
    path: typeof import("node:path");
  };
  /** Base directory for the project (needed for Node.js transpilation) */
  baseDir?: string;
}

/** Cache for transpiled modules to avoid re-transpiling the same file */
const transpileCache = new Map<string, unknown>();

/**
 * Import a TypeScript module in a platform-aware way.
 * - Deno: Transpile to rewrite npm package imports, then import
 * - Node.js: Transpile with esbuild first, then import
 */
async function importModule(
  file: string,
  context: FileDiscoveryContext,
): Promise<unknown> {
  // Check cache first (applies to both Deno and Node.js)
  const cacheKey = file;
  if (transpileCache.has(cacheKey)) {
    return transpileCache.get(cacheKey);
  }

  const fs = createFileSystem();
  const filePath = file.replace("file://", "");

  // Read the source file
  let source: string;
  try {
    source = await fs.readTextFile(filePath);
  } catch (error) {
    throw new Error(`Failed to read file ${filePath}: ${error}`);
  }

  // Determine loader based on file extension
  const isTsx = filePath.endsWith(".tsx");
  const isJsx = filePath.endsWith(".jsx");
  const loader = isTsx ? "tsx" : isJsx ? "jsx" : filePath.endsWith(".ts") ? "ts" : "js";

  // Transpile with esbuild
  const { build } = await import("esbuild");

  // Get the directory containing the file for resolving relative imports
  const fileDir = pathHelper.dirname(filePath);

  // Extract relative imports from source to mark them as external
  // This is needed because esbuild in WASM mode has limited filesystem access
  const relativeImportPattern = /from\s+["'](\.\.[^"']+)["']/g;
  const relativeImports: string[] = [];
  let match;
  while ((match = relativeImportPattern.exec(source)) !== null) {
    if (match[1]) {
      relativeImports.push(match[1]);
    }
  }

  const result = await build({
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    jsx: "automatic",
    jsxImportSource: "react",
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
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
      // Mark relative imports as external to avoid filesystem access issues
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

  // Write to temp file and import
  const tempDir = await fs.makeTempDir({ prefix: "vf-discovery-" });
  const tempFile = pathHelper.join(tempDir, "module.mjs");

  // Rewrite imports based on platform
  let transformedCode: string;
  if (isDeno) {
    // In Deno, rewrite to npm: specifiers and resolve relative imports
    transformedCode = rewriteForDeno(js, fileDir);
  } else {
    // In Node.js, rewrite to absolute paths
    transformedCode = await rewriteDiscoveryImports(js, context.baseDir || ".", fs, fileDir);
  }

  await fs.writeTextFile(tempFile, transformedCode);

  try {
    const module = await import(`file://${tempFile}?v=${Date.now()}`);
    transpileCache.set(cacheKey, module);
    return module;
  } finally {
    // Clean up temp file
    await fs.remove(tempDir, { recursive: true });
  }
}

/**
 * Rewrite imports for Deno (use npm: specifiers and resolve relative imports)
 */
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

/**
 * Rewrite external imports to absolute paths for Node.js compatibility
 */
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
    // This handles imports like "../../lib/github-client.ts" that were marked external
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
  /** Base directory (usually project root) */
  baseDir: string;

  /** AI directory (relative to baseDir) */
  aiDir?: string;

  /** Tool directories */
  toolDirs?: string[];

  /** Agent directories */
  agentDirs?: string[];

  /** Resource directories */
  resourceDirs?: string[];

  /** Prompt directories */
  promptDirs?: string[];

  /** Enable verbose logging */
  verbose?: boolean;

  /** Optional filesystem adapter for cross-platform support (Cloudflare Workers, etc.) */
  fsAdapter?: FileSystemAdapter;
}

export interface DiscoveryResult {
  tools: Map<string, Tool>;
  agents: Map<string, Agent>;
  resources: Map<string, Resource>;
  prompts: Map<string, Prompt>;
  errors: Array<{ file: string; error: Error }>;
}

/**
 * Discover and register all AI components
 */
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

/**
 * Discover tools in a directory
 */
async function discoverTools(
  dir: string,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
  verbose?: boolean,
): Promise<void> {
  const files = await findTypeScriptFiles(dir, context);

  if (verbose) {
    agentLogger.info(`[Discovery] Found ${files.length} tool files in ${dir}`);
  }

  for (const file of files) {
    try {
      const module = await importModule(file, context);
      const tool = (module as { default?: Tool }).default as Tool;

      if (!tool || typeof tool.execute !== "function") {
        if (verbose) {
          agentLogger.warn(`[Discovery] ${file} does not export a valid tool`);
        }
        continue;
      }

      const id = filenameToId(file);
      const toolWithId = { ...tool, id };
      registerTool(id, toolWithId);
      result.tools.set(id, toolWithId);

      if (verbose) {
        agentLogger.info(`[Discovery] Registered tool: ${id}`);
      }
    } catch (error) {
      result.errors.push({
        file,
        error: error instanceof Error ? error : new Error(String(error)),
      });

      if (verbose) {
        agentLogger.error(`[Discovery] Error loading ${file}:`, error);
      }
    }
  }
}

/**
 * Discover agents in a directory
 */
async function discoverAgents(
  dir: string,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
  verbose?: boolean,
): Promise<void> {
  const files = await findTypeScriptFiles(dir, context);

  if (verbose) {
    agentLogger.info(`[Discovery] Found ${files.length} agent files in ${dir}`);
  }

  for (const file of files) {
    try {
      const module = await importModule(file, context);
      const agent = (module as { default?: Agent }).default as Agent;

      if (!agent || typeof agent.generate !== "function") {
        if (verbose) {
          agentLogger.warn(`[Discovery] ${file} does not export a valid agent`);
        }
        continue;
      }

      const id = agent.id || filenameToId(file);

      // Register in the global agent registry
      registerAgent(id, agent);
      result.agents.set(id, agent);

      // Track the file path for index generation
      trackAgentPath(id, file);

      if (verbose) {
        agentLogger.info(`[Discovery] Registered agent: ${id}`);
      }
    } catch (error) {
      result.errors.push({
        file,
        error: error instanceof Error ? error : new Error(String(error)),
      });

      if (verbose) {
        agentLogger.error(`[Discovery] Error loading ${file}:`, error);
      }
    }
  }
}

/**
 * Discover resources in a directory
 */
async function discoverResources(
  dir: string,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
  verbose?: boolean,
): Promise<void> {
  const files = await findTypeScriptFiles(dir, context);

  if (verbose) {
    agentLogger.info(`[Discovery] Found ${files.length} resource files in ${dir}`);
  }

  for (const file of files) {
    try {
      const module = await importModule(file, context);
      const resource = (module as { default?: Resource }).default as Resource;

      if (!resource || typeof resource.load !== "function") {
        if (verbose) {
          agentLogger.warn(`[Discovery] ${file} does not export a valid resource`);
        }
        continue;
      }

      const id = filenameToId(file);
      const pattern = filePathToPattern(file, dir);
      const resourceWithMeta = { ...resource, id, pattern };
      registerResource(id, resourceWithMeta);
      result.resources.set(id, resourceWithMeta);

      if (verbose) {
        agentLogger.info(`[Discovery] Registered resource: ${id} (${pattern})`);
      }
    } catch (error) {
      result.errors.push({
        file,
        error: error instanceof Error ? error : new Error(String(error)),
      });

      if (verbose) {
        agentLogger.error(`[Discovery] Error loading ${file}:`, error);
      }
    }
  }
}

/**
 * Discover prompts in a directory
 */
async function discoverPrompts(
  dir: string,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
  verbose?: boolean,
): Promise<void> {
  const files = await findTypeScriptFiles(dir, context);

  if (verbose) {
    agentLogger.info(`[Discovery] Found ${files.length} prompt files in ${dir}`);
  }

  for (const file of files) {
    try {
      const module = await importModule(file, context);
      const promptInstance = (module as { default?: Prompt }).default as Prompt;

      if (!promptInstance || typeof promptInstance.getContent !== "function") {
        if (verbose) {
          agentLogger.warn(`[Discovery] ${file} does not export a valid prompt`);
        }
        continue;
      }

      const id = filenameToId(file);
      const promptWithId = { ...promptInstance, id };
      registerPrompt(id, promptWithId);
      result.prompts.set(id, promptWithId);

      if (verbose) {
        agentLogger.info(`[Discovery] Registered prompt: ${id}`);
      }
    } catch (error) {
      result.errors.push({
        file,
        error: error instanceof Error ? error : new Error(String(error)),
      });

      if (verbose) {
        agentLogger.error(`[Discovery] Error loading ${file}:`, error);
      }
    }
  }
}

/**
 * Find all TypeScript files in a directory (recursively)
 */
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

/**
 * Convert filename to camelCase ID
 */
function filenameToId(filePath: string): string {
  const filename = filePath.split("/").pop()?.replace(/\.(ts|tsx|js|jsx)$/, "") || "";

  return filename
    .replace(/[-_](.)/g, (_, char) => char.toUpperCase())
    .replace(/^[A-Z]/, (char) => char.toLowerCase());
}

/**
 * Convert file path to resource pattern
 */
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

/**
 * Tracked agent file paths for index generation
 */
const discoveredAgentPaths = new Map<string, string>();

/**
 * Generate an index file that exports all discovered agents
 * This allows API routes to import agents from a known location
 *
 * @example
 * // Generated file: ai/.generated/agents.ts
 * export { default as assistant } from '../agents/assistant';
 *
 * // Usage in API route:
 * import { assistant } from '../../ai/.generated/agents';
 */
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

/**
 * Track agent file path during discovery
 */
function trackAgentPath(id: string, filePath: string): void {
  discoveredAgentPaths.set(id, filePath);
}

/**
 * Clear tracked agent paths (for re-discovery)
 */
export function clearTrackedAgents(): void {
  discoveredAgentPaths.clear();
}

/**
 * Clear the transpile cache (for HMR/development)
 */
export function clearTranspileCache(): void {
  transpileCache.clear();
}
