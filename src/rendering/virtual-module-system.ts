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
import { snapshotImportMap } from "#veryfront/transforms/pipeline/cache-identity.ts";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import { containsPathControlCharacters } from "#veryfront/utils/route-path-utils.ts";

interface VirtualModule {
  id: string;
  source: string;
  transformed?: string;
  contentType: string;
}

interface StoredVirtualModule extends VirtualModule {
  retainedBytes: number;
}

export interface VirtualModuleSystemContext {
  projectId?: string;
  contentSourceId?: string;
  config?: VeryfrontConfig;
  importMap?: ImportMapConfig;
}

export interface VirtualModuleRegistration {
  id: string;
  source: string;
  fileType?: "tsx" | "jsx" | "ts" | "js";
}

const MAX_BASE_URL_LENGTH = 2_048;
const MAX_MODULE_ID_LENGTH = 1_024;
const MAX_MODULE_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_RETAINED_MODULE_BYTES = 64 * 1024 * 1024;
const MAX_VIRTUAL_MODULES = 10_000;
const MAX_PENDING_REGISTRATIONS = 32;
const MAX_PENDING_MODULES = 10_000;
const MAX_PENDING_SOURCE_BYTES = 32 * 1024 * 1024;
const ALLOWED_LOADERS = new Set(["tsx", "jsx", "ts", "js"]);

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
  private readonly modules = new Map<string, StoredVirtualModule>();
  private readonly baseUrl: string;
  private readonly adapter: RuntimeAdapter;
  private readonly context?: VirtualModuleSystemContext;
  private retainedModuleBytes = 0;
  private pendingRegistrations = 0;
  private pendingModules = 0;
  private pendingSourceBytes = 0;
  private registrationSequence = 0;
  private lifecycleGeneration = 0;
  private readonly latestRegistrationById = new Map<string, number>();

  constructor(
    baseUrl: string = "/_veryfront/modules",
    adapter?: RuntimeAdapter,
    context?: VirtualModuleSystemContext,
  ) {
    if (!adapter) {
      throw toError(
        createError({
          type: "render",
          message: "VirtualModuleSystem requires a RuntimeAdapter to be provided",
        }),
      );
    }

    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.adapter = adapter;
    this.context = context
      ? Object.freeze({
        projectId: context.projectId,
        contentSourceId: context.contentSourceId,
        config: context.config,
        importMap: context.importMap ? snapshotImportMap(context.importMap) : undefined,
      })
      : undefined;
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
    const urls = await this.registerModules([{ id, source, fileType }], projectDir);
    return urls[0]!;
  }

  /**
   * Transform and retain a set of modules as one transaction.
   *
   * No module in the batch becomes visible unless every source transforms and
   * the complete batch fits the configured retention budgets.
   */
  async registerModules(
    registrations: readonly VirtualModuleRegistration[],
    projectDir: string,
  ): Promise<string[]> {
    validateProjectDirectory(projectDir);
    if (!Array.isArray(registrations)) {
      throw new TypeError("Virtual module registrations must be an array");
    }
    if (registrations.length > MAX_VIRTUAL_MODULES) {
      throw new RangeError(
        `Virtual module count limit of ${MAX_VIRTUAL_MODULES} was exceeded`,
      );
    }

    const ids = new Set<string>();
    const inputs: Array<
      VirtualModuleRegistration & {
        loader: "tsx" | "jsx" | "ts" | "js";
        sourceBytes: number;
      }
    > = [];
    let batchSourceBytes = 0;

    for (const registration of registrations) {
      if (typeof registration !== "object" || registration === null) {
        throw new TypeError("Virtual module registration must be an object");
      }
      const { id, source, fileType } = registration;
      validateModuleId(id);
      if (ids.has(id)) {
        throw new TypeError(`Virtual module batch contains duplicate ID "${id}"`);
      }
      ids.add(id);

      if (typeof source !== "string") {
        throw new TypeError("Virtual module source must be a string");
      }
      const sourceBytes = boundedUtf8Length(
        source,
        MAX_MODULE_SOURCE_BYTES,
        "Virtual module source",
      );
      if (fileType !== undefined && !ALLOWED_LOADERS.has(fileType)) {
        throw new TypeError("Virtual module loader must be tsx, jsx, ts, or js");
      }
      if (sourceBytes > MAX_PENDING_SOURCE_BYTES - batchSourceBytes) {
        throw new RangeError(
          `Virtual module pending source byte limit of ${MAX_PENDING_SOURCE_BYTES} was exceeded`,
        );
      }
      batchSourceBytes += sourceBytes;
      inputs.push({
        id,
        source,
        fileType,
        loader: fileType ?? inferLoaderFromSource(source),
        sourceBytes,
      });
    }

    if (inputs.length === 0) return [];

    this.admitPendingRegistration(batchSourceBytes, inputs.length);
    const sequence = ++this.registrationSequence;
    const generation = this.lifecycleGeneration;
    for (const { id } of inputs) this.latestRegistrationById.set(id, sequence);

    try {
      const importMap = await this.resolveImportMap(projectDir);
      this.assertRegistrationGeneration(generation);

      const prepared: StoredVirtualModule[] = [];
      for (const input of inputs) {
        prepared.push(
          await this.transformModule(input, importMap, generation),
        );
      }

      this.assertRegistrationGeneration(generation);
      for (const { id } of inputs) {
        if (this.latestRegistrationById.get(id) !== sequence) {
          throw new Error("Virtual module registration was superseded");
        }
      }
      this.retainModules(prepared);
      return inputs.map(({ id }) => createModuleUrl(this.baseUrl, id));
    } finally {
      this.pendingRegistrations -= 1;
      this.pendingModules -= inputs.length;
      this.pendingSourceBytes -= batchSourceBytes;
      for (const { id } of inputs) {
        if (this.latestRegistrationById.get(id) === sequence) {
          this.latestRegistrationById.delete(id);
        }
      }
    }
  }

  getModule(id: string): VirtualModule | undefined {
    const module = this.modules.get(id);
    if (!module) return undefined;
    return {
      id: module.id,
      source: module.source,
      transformed: module.transformed,
      contentType: module.contentType,
    };
  }

  handleRequest(request: Request): Response | null {
    const url = new URL(request.url);
    const pathPrefix = `${this.baseUrl}/`;
    const isBasePath = url.pathname === this.baseUrl;
    if (!isBasePath && !url.pathname.startsWith(pathPrefix)) return null;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { Allow: "GET, HEAD, OPTIONS" },
      });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return textResponse(request, "Method not allowed", 405, {
        Allow: "GET, HEAD, OPTIONS",
      });
    }
    if (isBasePath) {
      return textResponse(request, "Module ID is required", 404);
    }

    const encodedModuleId = url.pathname.slice(pathPrefix.length);
    if (encodedModuleId.includes("/")) {
      return textResponse(request, "Invalid module ID", 400);
    }

    let moduleId: string;
    try {
      moduleId = decodeURIComponent(encodedModuleId);
      validateModuleId(moduleId);
    } catch {
      return textResponse(request, "Invalid module ID", 400);
    }

    const module = this.modules.get(moduleId);
    if (!module) return textResponse(request, "Module not found", 404);

    return new Response(
      request.method === "HEAD" ? null : module.transformed ?? module.source,
      {
        headers: {
          "Content-Type": module.contentType,
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }

  clear(): void {
    this.lifecycleGeneration += 1;
    this.modules.clear();
    this.retainedModuleBytes = 0;
    this.latestRegistrationById.clear();
  }

  private admitPendingRegistration(
    sourceBytes: number,
    moduleCount: number,
  ): void {
    if (this.pendingRegistrations >= MAX_PENDING_REGISTRATIONS) {
      throw new RangeError(
        `Virtual module pending registration limit of ${MAX_PENDING_REGISTRATIONS} was exceeded`,
      );
    }
    if (sourceBytes > MAX_PENDING_SOURCE_BYTES - this.pendingSourceBytes) {
      throw new RangeError(
        `Virtual module pending source byte limit of ${MAX_PENDING_SOURCE_BYTES} was exceeded`,
      );
    }
    if (moduleCount > MAX_PENDING_MODULES - this.pendingModules) {
      throw new RangeError(
        `Virtual module pending module limit of ${MAX_PENDING_MODULES} was exceeded`,
      );
    }
    this.pendingRegistrations += 1;
    this.pendingModules += moduleCount;
    this.pendingSourceBytes += sourceBytes;
  }

  private assertRegistrationGeneration(generation: number): void {
    if (generation !== this.lifecycleGeneration) {
      throw new Error("Virtual module registration was invalidated");
    }
  }

  private async transformModule(
    input: VirtualModuleRegistration & {
      loader: "tsx" | "jsx" | "ts" | "js";
      sourceBytes: number;
    },
    importMap: ImportMapConfig,
    generation: number,
  ): Promise<StoredVirtualModule> {
    const result = await transformJsx(input.source, { loader: input.loader });
    this.assertRegistrationGeneration(generation);

    let transformedCode = transformImportsWithMap(result.code, importMap, undefined, {
      resolveBare: true,
    });

    transformedCode = transformedCode
      .replace(
        /from\s+["']https?:\/\/[^"']+react@[^"']+\/jsx-runtime["']/g,
        'from "react/jsx-runtime"',
      )
      .replace(
        /from\s+["']https?:\/\/[^"']+react@[^"']+\/jsx-dev-runtime["']/g,
        'from "react/jsx-dev-runtime"',
      )
      .replace(
        /from\s+["']\.\/([\w-]+)(?:\.(?:t|j)sx?)?["']/g,
        (_match, componentName: string) => `from "${this.baseUrl}/component:${componentName}"`,
      )
      .replace(
        /import\(["']\.\/([\w-]+)(?:\.(?:t|j)sx?)?["']\)/g,
        (_match, componentName: string) => `import("${this.baseUrl}/component:${componentName}")`,
      );

    const transformedBytes = boundedUtf8Length(
      transformedCode,
      MAX_MODULE_SOURCE_BYTES,
      "Transformed virtual module",
    );
    return {
      id: input.id,
      source: input.source,
      transformed: transformedCode,
      contentType: "application/javascript",
      retainedBytes: input.sourceBytes + transformedBytes,
    };
  }

  private retainModules(modules: readonly StoredVirtualModule[]): void {
    let newModuleCount = this.modules.size;
    let retainedBytes = this.retainedModuleBytes;
    for (const module of modules) {
      const existing = this.modules.get(module.id);
      if (!existing) newModuleCount += 1;
      retainedBytes = retainedBytes -
        (existing?.retainedBytes ?? 0) +
        module.retainedBytes;
    }

    if (newModuleCount > MAX_VIRTUAL_MODULES) {
      throw new RangeError(
        `Virtual module count limit of ${MAX_VIRTUAL_MODULES} was exceeded`,
      );
    }
    if (retainedBytes > MAX_RETAINED_MODULE_BYTES) {
      throw new RangeError(
        `Virtual module retained byte limit of ${MAX_RETAINED_MODULE_BYTES} was exceeded`,
      );
    }

    for (const module of modules) {
      this.modules.set(module.id, Object.freeze(module));
    }
    this.retainedModuleBytes = retainedBytes;
  }
}

function normalizeBaseUrl(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_BASE_URL_LENGTH ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    throw new TypeError(
      "Virtual module base URL must be a non-empty absolute path",
    );
  }
  if (
    /[\s"'`<>\\?#]/u.test(value) ||
    containsPathControlCharacters(value)
  ) {
    throw new TypeError("Virtual module base URL contains unsafe characters");
  }

  const normalized = value.endsWith("/") ? value.slice(0, -1) : value;
  if (normalized === "") {
    throw new TypeError("Virtual module base URL cannot be the site root");
  }
  const segments = normalized.slice(1).split("/");
  if (segments.some((segment) => segment.length === 0)) {
    throw new TypeError("Virtual module base URL must use a canonical path");
  }

  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new TypeError("Virtual module base URL must use valid encoding");
    }
    if (
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      containsPathControlCharacters(decoded)
    ) {
      throw new TypeError("Virtual module base URL must use a canonical path");
    }
  }
  return normalized;
}

function validateModuleId(id: string): void {
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    id.length > MAX_MODULE_ID_LENGTH ||
    id === "." ||
    id === ".." ||
    containsPathControlCharacters(id)
  ) {
    throw new TypeError(
      `Virtual module ID must contain between 1 and ${MAX_MODULE_ID_LENGTH} safe characters`,
    );
  }
}

function validateProjectDirectory(projectDir: string): void {
  if (
    typeof projectDir !== "string" ||
    projectDir.length === 0 ||
    projectDir.length > MAX_PATH_LENGTH_CHARS ||
    containsPathControlCharacters(projectDir)
  ) {
    throw new TypeError("Virtual module project directory is invalid");
  }
}

function createModuleUrl(baseUrl: string, id: string): string {
  try {
    return `${baseUrl}/${encodeURIComponent(id)}`;
  } catch {
    throw new TypeError("Virtual module ID must be valid Unicode");
  }
}

function boundedUtf8Length(
  value: string,
  limit: number,
  label: string,
): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }

    if (bytes > limit) {
      throw new RangeError(`${label} byte limit of ${limit} was exceeded`);
    }
  }
  return bytes;
}

function textResponse(
  request: Request,
  body: string,
  status: number,
  headers?: HeadersInit,
): Response {
  return new Response(request.method === "HEAD" ? null : body, {
    status,
    headers,
  });
}
