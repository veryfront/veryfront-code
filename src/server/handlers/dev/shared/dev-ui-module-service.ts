import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { resolve } from "#veryfront/compat/path/index.ts";
import { isWithinDirectory } from "#veryfront/security/path-validation.ts";
import type { transformUiModule } from "./ui-module-transform.ts";

const MODULE_EXTENSIONS = [".tsx", ".ts"] as const;
const MAX_MODULE_PATH_LENGTH = 256;
const MAX_ENCODED_MODULE_PATH_LENGTH = MAX_MODULE_PATH_LENGTH * 3;
const MAX_MODULE_PATH_SEGMENTS = 16;
const MAX_SOURCE_BYTES = 1_048_576;
const MAX_TRANSFORMED_MODULE_BYTES = 2_097_152;
const MAX_CACHE_ENTRIES = 128;
const CACHE_TTL_MS = 5_000;
const SAFE_MODULE_SEGMENT = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
const textEncoder = new TextEncoder();

function exceedsUtf8Limit(value: string, limit: number): boolean {
  return value.length > limit || textEncoder.encode(value).byteLength > limit;
}

export interface DevUiModuleDependencies {
  readTextFile(path: string): Promise<string>;
  realPath(path: string): Promise<string>;
  stat(path: string): Promise<{ isFile: boolean; size: number }>;
  transformUiModule: typeof transformUiModule;
}

export interface DevUiModuleRequest {
  uiDirectory: string;
  relativePath: string;
  sourcePath: string;
  manifestFiles: Readonly<Record<string, string>>;
  transform: {
    spanName: string;
    importBasePath: string;
  };
}

export type DevUiModuleResult =
  | { kind: "loaded"; code: string }
  | { kind: "missing" }
  | { kind: "unsafe" }
  | { kind: "unavailable"; phase: "source" | "output"; error?: unknown }
  | { kind: "transform-failed"; error: unknown };

type SourceResult =
  | { kind: "found"; cacheKey: string; source: string; transformPath: string }
  | { kind: "missing" }
  | { kind: "unsafe" }
  | { kind: "unavailable"; error?: unknown };

type TransformResult =
  | { kind: "loaded"; code: string }
  | { kind: "unavailable"; phase: "output" }
  | { kind: "transform-failed"; error: unknown };

export class DevUiModuleCache {
  readonly #entries = new Map<string, { code: string; timestamp: number }>();
  readonly #inFlight = new Map<string, Promise<TransformResult>>();
  #generation = 0;

  clear(): void {
    this.#generation++;
    this.#entries.clear();
    this.#inFlight.clear();
  }

  get size(): number {
    return this.#entries.size;
  }

  load(
    cacheKey: string,
    transform: () => Promise<string>,
  ): Promise<TransformResult> {
    const now = performance.now();
    const cached = this.#entries.get(cacheKey);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      this.#entries.delete(cacheKey);
      this.#entries.set(cacheKey, cached);
      return Promise.resolve({ kind: "loaded", code: cached.code });
    }
    if (cached) this.#entries.delete(cacheKey);

    const active = this.#inFlight.get(cacheKey);
    if (active) return active;

    const pending = this.#transformAndCache(cacheKey, transform, this.#generation);
    this.#inFlight.set(cacheKey, pending);
    return pending.finally(() => {
      if (this.#inFlight.get(cacheKey) === pending) this.#inFlight.delete(cacheKey);
    });
  }

  async #transformAndCache(
    cacheKey: string,
    transform: () => Promise<string>,
    generation: number,
  ): Promise<TransformResult> {
    let code: string;
    try {
      code = await transform();
    } catch (error) {
      return { kind: "transform-failed", error };
    }

    if (exceedsUtf8Limit(code, MAX_TRANSFORMED_MODULE_BYTES)) {
      return { kind: "unavailable", phase: "output" };
    }

    if (generation !== this.#generation) return { kind: "loaded", code };

    this.#entries.delete(cacheKey);
    this.#entries.set(cacheKey, { code, timestamp: performance.now() });
    while (this.#entries.size > MAX_CACHE_ENTRIES) {
      const oldestKey = this.#entries.keys().next().value;
      if (typeof oldestKey !== "string") break;
      this.#entries.delete(oldestKey);
    }
    return { kind: "loaded", code };
  }
}

export function parseDevUiModulePath(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const encoded = pathname.slice(prefix.length);
  if (encoded.length === 0 || encoded.length > MAX_ENCODED_MODULE_PATH_LENGTH) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    return null;
  }

  const relativePath = decoded.endsWith(".js") ? decoded.slice(0, -3) : decoded;
  if (relativePath.length === 0 || relativePath.length > MAX_MODULE_PATH_LENGTH) return null;

  const segments = relativePath.split("/");
  if (
    segments.length > MAX_MODULE_PATH_SEGMENTS ||
    segments.some((segment) => !SAFE_MODULE_SEGMENT.test(segment))
  ) {
    return null;
  }
  return relativePath;
}

async function readSource(
  request: DevUiModuleRequest,
  deps: DevUiModuleDependencies,
): Promise<SourceResult> {
  let canonicalUiDirectory: string | null = null;
  try {
    canonicalUiDirectory = await deps.realPath(request.uiDirectory);
  } catch (error) {
    if (!isNotFoundError(error)) return { kind: "unavailable", error };
  }

  if (canonicalUiDirectory) {
    for (const extension of MODULE_EXTENSIONS) {
      const candidatePath = resolve(request.uiDirectory, `${request.sourcePath}${extension}`);
      if (!isWithinDirectory(request.uiDirectory, candidatePath)) return { kind: "unsafe" };

      let canonicalFilePath: string;
      try {
        canonicalFilePath = await deps.realPath(candidatePath);
      } catch (error) {
        if (isNotFoundError(error)) continue;
        return { kind: "unavailable", error };
      }
      if (!isWithinDirectory(canonicalUiDirectory, canonicalFilePath)) {
        return { kind: "unsafe" };
      }

      try {
        const metadata = await deps.stat(canonicalFilePath);
        if (
          !metadata.isFile ||
          !Number.isSafeInteger(metadata.size) ||
          metadata.size < 0 ||
          metadata.size > MAX_SOURCE_BYTES
        ) {
          return { kind: "unavailable" };
        }
        const source = await deps.readTextFile(canonicalFilePath);
        if (exceedsUtf8Limit(source, MAX_SOURCE_BYTES)) {
          return { kind: "unavailable" };
        }
        return {
          kind: "found",
          cacheKey: canonicalFilePath,
          source,
          transformPath: `${request.sourcePath}${extension}`,
        };
      } catch (error) {
        if (isNotFoundError(error)) continue;
        return { kind: "unavailable", error };
      }
    }
  }

  for (const extension of MODULE_EXTENSIONS) {
    const manifestPath = `${request.sourcePath}${extension}`;
    const source = request.manifestFiles[manifestPath];
    if (typeof source !== "string") continue;
    if (exceedsUtf8Limit(source, MAX_SOURCE_BYTES)) {
      return { kind: "unavailable" };
    }
    return { kind: "found", cacheKey: manifestPath, source, transformPath: manifestPath };
  }
  return { kind: "missing" };
}

export async function loadDevUiModule(
  request: DevUiModuleRequest,
  deps: DevUiModuleDependencies,
  cache: DevUiModuleCache,
): Promise<DevUiModuleResult> {
  const source = await readSource(request, deps);
  if (source.kind === "unsafe" || source.kind === "missing") return source;
  if (source.kind === "unavailable") {
    return { kind: "unavailable", phase: "source", error: source.error };
  }

  return await cache.load(
    source.cacheKey,
    () =>
      deps.transformUiModule(
        source.transformPath,
        source.source,
        request.relativePath,
        request.transform,
      ),
  );
}
