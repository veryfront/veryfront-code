import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { logger } from "#veryfront/utils";

const CACHE_DIR = join(tmpdir(), "veryfront-module-cache");

interface ResolveContext {
  conditions: string[];
  importAttributes: Record<string, string>;
  parentURL?: string;
}

interface LoadContext {
  conditions: string[];
  importAttributes: Record<string, string>;
  format?: string;
}

type NextResolve = (
  specifier: string,
  context?: ResolveContext,
) => Promise<{ url: string; format?: string; shortCircuit?: boolean }>;

type NextLoad = (
  url: string,
  context?: LoadContext,
) => Promise<{ format: string; source: string | ArrayBuffer; shortCircuit?: boolean }>;

function isHttpUrl(value: string | undefined): boolean {
  return value?.startsWith("https://") || value?.startsWith("http://") || false;
}

function getCacheKey(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

function getCachePath(url: string): string {
  const key = getCacheKey(url);
  const ext = url.includes(".mjs") ? ".mjs" : ".js";
  return join(CACHE_DIR, `${key}${ext}`);
}

async function ensureCacheDir(): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
  } catch {
    // Directory may already exist
  }
}

async function readFromCache(url: string): Promise<string | null> {
  try {
    return await readFile(getCachePath(url), "utf-8");
  } catch {
    return null;
  }
}

async function writeToCache(url: string, content: string): Promise<void> {
  try {
    await ensureCacheDir();
    await writeFile(getCachePath(url), content, "utf-8");
  } catch (error) {
    logger.warn("[http-loader] Failed to cache module", { url, error });
  }
}

async function fetchModule(url: string): Promise<string> {
  const cached = await readFromCache(url);
  if (cached !== null) return cached;

  const response = await fetch(url, {
    headers: {
      Accept: "application/javascript, text/javascript, */*",
      "User-Agent": "veryfront-node-loader/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const content = await response.text();
  await writeToCache(url, content);
  return content;
}

export function resolve(
  specifier: string,
  context: ResolveContext,
  nextResolve: NextResolve,
):
  | Promise<{ url: string; format?: string; shortCircuit?: boolean }>
  | { url: string; format?: string; shortCircuit?: boolean } {
  if (isHttpUrl(specifier)) {
    return { url: specifier, format: "module", shortCircuit: true };
  }

  if (!isHttpUrl(context.parentURL)) {
    return nextResolve(specifier, context);
  }

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return {
      url: new URL(specifier, context.parentURL).href,
      format: "module",
      shortCircuit: true,
    };
  }

  if (!specifier.startsWith("/") && !specifier.startsWith(".")) {
    return {
      url: `https://esm.sh/${specifier}`,
      format: "module",
      shortCircuit: true,
    };
  }

  return nextResolve(specifier, context);
}

export async function load(
  url: string,
  context: LoadContext,
  nextLoad: NextLoad,
): Promise<{ format: string; source: string | ArrayBuffer; shortCircuit?: boolean }> {
  if (!isHttpUrl(url)) {
    return nextLoad(url, context);
  }

  return {
    format: "module",
    source: await fetchModule(url),
    shortCircuit: true,
  };
}

export function initialize(data?: { clearCache?: boolean }): void {
  if (!data?.clearCache) return;

  // Could clear cache here if needed
  logger.debug("[http-loader] Initialized with cache clearing");
}
