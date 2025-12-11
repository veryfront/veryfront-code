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

  register(id: string, source: string, projectDir: string): Promise<string> {
    return this.registerModule(id, source, projectDir);
  }

  async registerModule(id: string, source: string, projectDir: string): Promise<string> {
    const importMap = await loadImportMap(projectDir, this.adapter);

    const hasTypeScript = source.includes("interface ") ||
      source.includes("type ") ||
      source.includes(": React.FC") ||
      (source.includes("<") && source.includes(">")) ||
      source.includes("Props>") ||
      source.includes("useState<") ||
      source.includes("useRef<");

    try {
      await initialize({ worker: false });
    } catch {
    }

    const result = await transform(source, {
      loader: hasTypeScript ? "tsx" : "jsx",
      jsx: "automatic",
      jsxImportSource: "react",
      format: "esm",
      target: "es2020",
    });

    let transformedCode = transformImportsWithMap(result.code, importMap, undefined, {
      resolveBare: true,
    });

    transformedCode = transformedCode
      .replace(/from\s+"https?:\/\/[^"']+react@[^"']+\/jsx-runtime"/g, 'from "react/jsx-runtime"')
      .replace(
        /from\s+"https?:\/\/[^"']+react@[^"']+\/jsx-dev-runtime"/g,
        'from "react/jsx-dev-runtime"',
      );

    transformedCode = transformedCode
      .replace(/from\s+["']\.\/(\w+)\.tsx["']/g, 'from "/_veryfront/modules/component:$1"')
      .replace(/from\s+["']\.\/(\w+)\.jsx["']/g, 'from "/_veryfront/modules/component:$1"')
      .replace(/from\s+["']\.\/(\w+)["']/g, 'from "/_veryfront/modules/component:$1"')
      .replace(/import\(["']\.\/(\w+)\.tsx["']\)/g, 'import("/_veryfront/modules/component:$1")')
      .replace(/import\(["']\.\/(\w+)\.jsx["']\)/g, 'import("/_veryfront/modules/component:$1")')
      .replace(/import\(["']\.\/(\w+)["']\)/g, 'import("/_veryfront/modules/component:$1")');

    const virtualModule: VirtualModule = {
      id,
      source,
      transformed: transformedCode,
      contentType: "application/javascript",
    };

    this.modules.set(id, virtualModule);
    return `${this.baseUrl}/${encodeURIComponent(id)}`;
  }

  getModule(id: string): VirtualModule | undefined {
    return this.modules.get(id);
  }

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

  clear() {
    this.modules.clear();
  }
}
