/**
 * Virtual Module System for Veryfront
 * Serves transformed components as proper ES modules that can use import maps
 */

import { initialize, transform } from "esbuild";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { createError, toError } from "../core/errors/veryfront-error.ts";
import { loadImportMap, transformImportsWithMap } from "@veryfront/modules/import-map/index.ts";

interface VirtualModule {
  id: string;
  source: string;
  transformed?: string;
  contentType: string;
}

export class VirtualModuleSystem {
  private modules: Map<string, VirtualModule> = new Map();
  private baseUrl: string;
  private adapter: RuntimeAdapter;

  constructor(baseUrl: string = "/_veryfront/modules", adapter?: RuntimeAdapter) {
    this.baseUrl = baseUrl;
    if (!adapter) {
      throw toError(createError({
        type: "render",
        message: "VirtualModuleSystem requires a RuntimeAdapter to be provided",
      }));
    }
    this.adapter = adapter;
  }

  /**
   * Register a virtual module (alias for registerModule)
   */
  register(id: string, source: string, projectDir: string): Promise<string> {
    return this.registerModule(id, source, projectDir);
  }

  /**
   * Register a virtual module
   */
  async registerModule(id: string, source: string, projectDir: string): Promise<string> {
    // Load import map for the project
    const importMap = await loadImportMap(projectDir, this.adapter);

    // Determine loader type based on source content
    const hasTypeScript = source.includes("interface ") ||
      source.includes("type ") ||
      source.includes(": React.FC") ||
      (source.includes("<") && source.includes(">")) ||
      source.includes("Props>") ||
      source.includes("useState<") ||
      source.includes("useRef<");

    // Ensure esbuild is initialized (idempotent, safe to call multiple times if it handles it,
    // but we wrap in try/catch just in case the specific version throws on re-init)
    try {
      await initialize({
        worker: false, // Use main thread for tests/simplicity, or true if needed
      });
    } catch {
      // Ignore "already initialized" errors
    }

    // Transform with esbuild first
    const result = await transform(source, {
      loader: hasTypeScript ? "tsx" : "jsx",
      jsx: "automatic",
      jsxImportSource: "react",
      format: "esm",
      target: "es2020",
    });

    // Then transform imports using import map (including JSX runtime)
    // Resolve bare imports (e.g., "react") to ESM URLs so modules are self-contained
    let transformedCode = transformImportsWithMap(result.code, importMap, undefined, {
      resolveBare: true,
    });

    // Keep JSX runtime import bare to satisfy environments that rely on import maps at runtime
    transformedCode = transformedCode
      .replace(/from\s+"https?:\/\/[^"']+react@[^"']+\/jsx-runtime"/g, 'from "react/jsx-runtime"')
      .replace(
        /from\s+"https?:\/\/[^"']+react@[^"']+\/jsx-dev-runtime"/g,
        'from "react/jsx-dev-runtime"',
      );

    // Transform relative component imports to virtual module URLs
    // Note: npm package transformations are handled in ComponentLoader before registration
    transformedCode = transformedCode
      .replace(/from\s+["']\.\/(\w+)\.tsx["']/g, 'from "/_veryfront/modules/component:$1"')
      .replace(/from\s+["']\.\/(\w+)\.jsx["']/g, 'from "/_veryfront/modules/component:$1"')
      .replace(/from\s+["']\.\/(\w+)["']/g, 'from "/_veryfront/modules/component:$1"')
      // Also transform dynamic imports in lazy() calls
      .replace(/import\(["']\.\/(\w+)\.tsx["']\)/g, 'import("/_veryfront/modules/component:$1")')
      .replace(/import\(["']\.\/(\w+)\.jsx["']\)/g, 'import("/_veryfront/modules/component:$1")')
      .replace(/import\(["']\.\/(\w+)["']\)/g, 'import("/_veryfront/modules/component:$1")');

    // Store the module
    const module: VirtualModule = {
      id,
      source,
      transformed: transformedCode,
      contentType: "application/javascript",
    };

    this.modules.set(id, module);

    // Return the URL that will serve this module
    return `${this.baseUrl}/${encodeURIComponent(id)}`;
  }

  /**
   * Get a virtual module by ID
   */
  getModule(id: string): VirtualModule | undefined {
    return this.modules.get(id);
  }

  /**
   * Handle HTTP requests for virtual modules
   */
  handleRequest(request: Request): Response | null {
    const url = new URL(request.url);

    if (!url.pathname.startsWith(this.baseUrl)) {
      return null;
    }

    const moduleId = decodeURIComponent(url.pathname.slice(this.baseUrl.length + 1));

    const module = this.modules.get(moduleId);
    if (!module) {
      return new Response("Module not found", { status: 404 });
    }

    return new Response(module.transformed || module.source, {
      headers: {
        "Content-Type": module.contentType,
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  }

  /**
   * Clear all virtual modules
   */
  clear() {
    this.modules.clear();
  }
}
