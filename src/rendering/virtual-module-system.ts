import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createError, toError } from "#veryfront/errors";
import { loadImportMap, transformImportsWithMap } from "#veryfront/modules/import-map/index.ts";
import { transformJsx } from "#veryfront/platform/compat/transform.ts";
import { replaceSpecifiers } from "#veryfront/transforms/esm/lexer.ts";

const DEFAULT_MAX_MODULES = 5_000;
const DEFAULT_MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MODULE_ID_PATTERN = /^[A-Za-z0-9:_-]+$/;

interface VirtualModule {
  id: string;
  source: string;
  transformed?: string;
  contentType: string;
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
  private readonly maxModules: number;
  private readonly maxSourceBytes: number;

  constructor(
    baseUrl: string = "/_veryfront/modules",
    adapter?: RuntimeAdapter,
    options: { maxModules?: number; maxSourceBytes?: number } = {},
  ) {
    if (!/^\/[A-Za-z0-9/_-]*[A-Za-z0-9_-]$/.test(baseUrl)) {
      throw new TypeError("Virtual module baseUrl must be a normalized absolute URL path");
    }
    this.baseUrl = baseUrl;
    this.maxModules = options.maxModules ?? DEFAULT_MAX_MODULES;
    this.maxSourceBytes = options.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES;
    if (!Number.isSafeInteger(this.maxModules) || this.maxModules <= 0) {
      throw new TypeError("Virtual module maxModules must be a positive integer");
    }
    if (!Number.isSafeInteger(this.maxSourceBytes) || this.maxSourceBytes <= 0) {
      throw new TypeError("Virtual module maxSourceBytes must be a positive integer");
    }

    if (!adapter) {
      throw toError(
        createError({
          type: "render",
          message: "VirtualModuleSystem requires a RuntimeAdapter to be provided",
        }),
      );
    }

    this.adapter = adapter;
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
    if (id.length === 0 || id.length > 1_024 || !MODULE_ID_PATTERN.test(id)) {
      throw new TypeError("Virtual module ID contains unsupported characters");
    }
    if (new TextEncoder().encode(source).byteLength > this.maxSourceBytes) {
      throw new RangeError("Virtual module source exceeds the configured size limit");
    }
    const importMap = await loadImportMap(projectDir, this.adapter);

    // Prefer the explicit file type supplied by the caller (it knows the extension).
    // Fall back to heuristic detection only when no type is provided.
    const loader: "tsx" | "jsx" | "ts" | "js" = fileType ?? inferLoaderFromSource(source);

    const result = await transformJsx(source, { loader });

    let transformedCode = transformImportsWithMap(result.code, importMap, undefined, {
      resolveBare: true,
    });

    transformedCode = await replaceSpecifiers(transformedCode, (specifier) => {
      if (/^https?:\/\/[^?#]+react@[^?#]+\/jsx-runtime(?:[?#].*)?$/.test(specifier)) {
        return "react/jsx-runtime";
      }
      if (/^https?:\/\/[^?#]+react@[^?#]+\/jsx-dev-runtime(?:[?#].*)?$/.test(specifier)) {
        return "react/jsx-dev-runtime";
      }
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;

      const path = specifier.split(/[?#]/, 1)[0] ?? "";
      const fileName = path.split("/").filter(Boolean).at(-1) ?? "";
      const componentName = fileName.replace(/\.(?:t|j)sx?$/, "");
      if (!componentName || !MODULE_ID_PATTERN.test(`component:${componentName}`)) return null;
      return `${this.baseUrl}/component:${componentName}`;
    });

    if (this.modules.has(id)) this.modules.delete(id);
    while (this.modules.size >= this.maxModules) {
      const oldest = this.modules.keys().next().value;
      if (oldest === undefined) break;
      this.modules.delete(oldest);
    }

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
    if (url.pathname !== this.baseUrl && !url.pathname.startsWith(`${this.baseUrl}/`)) return null;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { Allow: "GET, HEAD, OPTIONS" },
      });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD, OPTIONS" },
      });
    }

    let moduleId: string;
    try {
      moduleId = decodeURIComponent(url.pathname.slice(this.baseUrl.length + 1));
    } catch {
      return new Response("Malformed module identifier", { status: 400 });
    }
    if (!MODULE_ID_PATTERN.test(moduleId)) {
      return new Response("Invalid module identifier", { status: 400 });
    }
    const module = this.modules.get(moduleId);
    if (!module) return new Response("Module not found", { status: 404 });

    return new Response(request.method === "HEAD" ? null : module.transformed ?? module.source, {
      headers: {
        "Content-Type": module.contentType,
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  clear(): void {
    this.modules.clear();
  }
}
