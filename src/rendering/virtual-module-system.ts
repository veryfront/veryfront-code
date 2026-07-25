import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createError, toError } from "#veryfront/errors";
import type { VeryfrontConfig } from "#veryfront/config";
import {
  loadImportMap,
  preloadImportMap,
  transformImportsWithMap,
} from "#veryfront/modules/import-map/index.ts";
import type { ImportMapConfig } from "#veryfront/modules/import-map/types.ts";
import { transformJsx } from "#veryfront/platform/compat/transform.ts";

interface VirtualModule {
  id: string;
  source: string;
  transformed?: string;
  contentType: string;
}

export interface VirtualModuleSystemContext {
  projectId?: string;
  contentSourceId?: string;
  config?: VeryfrontConfig;
  importMap?: ImportMapConfig;
}

/**
 * Heuristic fallback: infer a JSX/TSX loader from source content when the
 * caller has not supplied an explicit file type. Callers that know the file
 * extension (e.g. by reading `entry.name`) should pass it as `fileType` to
 * `registerModule` instead of relying on this function.
 */
function inferLoaderFromSource(source: string): "tsx" | "jsx" {
  const hasTypeAnnotations = source.includes(": React.FC") ||
    source.includes("Props>") ||
    source.includes("useState<") ||
    source.includes("useRef<") ||
    // interface/type keywords are TS-specific; guard against bare words in strings
    /(?:^|\s)(?:interface|type)\s+\w/.test(source);
  return hasTypeAnnotations ? "tsx" : "jsx";
}

export class VirtualModuleSystem {
  private modules = new Map<string, VirtualModule>();
  private baseUrl: string;
  private adapter: RuntimeAdapter;
  private context?: VirtualModuleSystemContext;

  constructor(
    baseUrl: string = "/_veryfront/modules",
    adapter?: RuntimeAdapter,
    context?: VirtualModuleSystemContext,
  ) {
    this.baseUrl = baseUrl;

    if (!adapter) {
      throw toError(
        createError({
          type: "render",
          message: "VirtualModuleSystem requires a RuntimeAdapter to be provided",
        }),
      );
    }

    this.adapter = adapter;
    this.context = context;
  }

  private async resolveImportMap(projectDir: string): Promise<ImportMapConfig> {
    if (this.context?.importMap) return this.context.importMap;
    if (!this.context?.config) return await loadImportMap(projectDir, this.adapter);

    return await preloadImportMap(
      projectDir,
      this.adapter,
      this.context.projectId,
      {
        contentSourceId: this.context.contentSourceId,
        config: this.context.config,
      },
    );
  }

  /** Resolve the import-map snapshot bound to this virtual-module context. */
  getImportMap(projectDir: string): Promise<ImportMapConfig> {
    return this.resolveImportMap(projectDir);
  }

  register(
    id: string,
    source: string,
    projectDir: string,
    fileType?: "tsx" | "jsx" | "ts" | "js",
  ): Promise<string> {
    return this.registerModule(id, source, projectDir, fileType);
  }

  async registerModule(
    id: string,
    source: string,
    projectDir: string,
    fileType?: "tsx" | "jsx" | "ts" | "js",
  ): Promise<string> {
    const importMap = await this.resolveImportMap(projectDir);

    // Prefer the explicit file type supplied by the caller (it knows the extension).
    // Fall back to heuristic detection only when no type is provided.
    const loader: "tsx" | "jsx" | "ts" | "js" = fileType ?? inferLoaderFromSource(source);

    const result = await transformJsx(source, { loader });

    let transformedCode = transformImportsWithMap(result.code, importMap, undefined, {
      resolveBare: true,
    });

    transformedCode = transformedCode
      // Handle both single- and double-quoted react runtime imports
      .replace(
        /from\s+["']https?:\/\/[^"']+react@[^"']+\/jsx-runtime["']/g,
        'from "react/jsx-runtime"',
      )
      .replace(
        /from\s+["']https?:\/\/[^"']+react@[^"']+\/jsx-dev-runtime["']/g,
        'from "react/jsx-dev-runtime"',
      )
      // Rewrite single-segment relative imports (including kebab-case names like ./my-button)
      .replace(
        /from\s+["']\.\/([\w-]+)(?:\.(?:t|j)sx?)?["']/g,
        'from "/_veryfront/modules/component:$1"',
      )
      .replace(
        /import\(["']\.\/([\w-]+)(?:\.(?:t|j)sx?)?["']\)/g,
        'import("/_veryfront/modules/component:$1")',
      );

    this.modules.set(id, {
      id,
      source,
      transformed: transformedCode,
      contentType: "application/javascript",
    });

    return `${this.baseUrl}/${encodeURIComponent(id)}`;
  }

  getModule(id: string): VirtualModule | undefined {
    return this.modules.get(id);
  }

  handleRequest(request: Request): Response | null {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(this.baseUrl)) return null;

    const moduleId = decodeURIComponent(url.pathname.slice(this.baseUrl.length + 1));
    const module = this.modules.get(moduleId);
    if (!module) return new Response("Module not found", { status: 404 });

    return new Response(module.transformed ?? module.source, {
      headers: {
        "Content-Type": module.contentType,
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  }

  clear(): void {
    this.modules.clear();
  }
}
