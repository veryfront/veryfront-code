import type { VeryfrontConfig } from "./types.ts";
import { findUnknownTopLevelKeys, validateVeryfrontConfig } from "./schema.ts";
import { dirname, join } from "std/path/mod.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { serverLogger } from "@veryfront/utils/logger/logger.ts";
import { getReactImportMap, REACT_DEFAULT_VERSION } from "@veryfront/utils/constants/cdn.ts";
import { DEFAULT_CACHE_DIR } from "@veryfront/utils/constants/server.ts";
import { DEFAULT_PORT } from "./defaults.ts";
import { createFileSystem } from "../../platform/compat/fs.ts";

export type { VeryfrontConfig } from "./types.ts";

function getDefaultImportMapForConfig() {
  return { imports: getReactImportMap(REACT_DEFAULT_VERSION) };
}

const DEFAULT_CONFIG: Partial<VeryfrontConfig> = {
  title: "Veryfront App",
  description: "Built with Veryfront",
  experimental: {
    esmLayouts: true,
  },
  router: undefined,
  defaultLayout: undefined,
  theme: {
    colors: {
      primary: "#3B82F6",
    },
  },
  build: {
    outDir: "dist",
    trailingSlash: false,
    esbuild: {
      wasmURL: "https://deno.land/x/esbuild@v0.20.1/esbuild.wasm",
      worker: false,
    },
  },
  cache: {
    dir: DEFAULT_CACHE_DIR,
    render: {
      type: "memory",
      ttl: undefined,
      maxEntries: 500,
      kvPath: undefined,
      redisUrl: undefined,
      redisKeyPrefix: undefined,
    },
  },
  dev: {
    port: DEFAULT_PORT,
    host: "localhost",
    open: false,
  },
  resolve: {
    importMap: getDefaultImportMapForConfig(),
  },
  client: {
    moduleResolution: "cdn",
    cdn: {
      provider: "esm.sh",
      versions: "auto",
    },
  },
};

const configCacheByProject = new Map<string, { revision: number; config: VeryfrontConfig }>();
let cacheRevision = 0;

function validateCorsConfig(userConfig: unknown): void {
  if (!userConfig || typeof userConfig !== "object") {
    return;
  }
  const config = userConfig as Record<string, unknown>;
  const security = config.security as Record<string, unknown> | undefined;
  const cors = security?.cors;
  if (!cors || typeof cors !== "object" || Array.isArray(cors)) {
    return;
  }

  const corsObj = cors as Record<string, unknown>;
  const origin = corsObj.origin;
  if (origin !== undefined && typeof origin !== "string") {
    throw new ConfigValidationError(
      "security.cors.origin must be a string. Expected boolean or { origin?: string }",
    );
  }
}

function validateConfigShape(userConfig: unknown): void {
  validateVeryfrontConfig(userConfig);
  const unknown = typeof userConfig === "object" && userConfig
    ? findUnknownTopLevelKeys(userConfig as Record<string, unknown>)
    : [];
  if (unknown.length > 0) {
    serverLogger.warn(`Unknown config keys: ${unknown.join(", ")}. These will be ignored.`);
  }
}

function mergeConfigs(userConfig: Partial<VeryfrontConfig>): VeryfrontConfig {
  const merged: VeryfrontConfig = {
    ...DEFAULT_CONFIG,
    ...userConfig,
    dev: {
      ...DEFAULT_CONFIG.dev,
      ...userConfig.dev,
    },
    theme: {
      ...DEFAULT_CONFIG.theme,
      ...userConfig.theme,
    },
    build: {
      ...DEFAULT_CONFIG.build,
      ...userConfig.build,
    },
    cache: {
      ...DEFAULT_CONFIG.cache,
      ...userConfig.cache,
    },
    resolve: {
      ...DEFAULT_CONFIG.resolve,
      ...userConfig.resolve,
    },
    client: {
      ...DEFAULT_CONFIG.client,
      ...userConfig.client,
      cdn: {
        ...DEFAULT_CONFIG.client?.cdn,
        ...userConfig.client?.cdn,
      },
    },
  } as VeryfrontConfig;

  if (merged.resolve) {
    const defaultMap = DEFAULT_CONFIG.resolve?.importMap;
    const userMap = userConfig.resolve?.importMap;

    if (defaultMap || userMap) {
      merged.resolve.importMap = {
        imports: {
          ...(defaultMap?.imports ?? {}),
          ...(userMap?.imports ?? {}),
        },
        scopes: {
          ...(defaultMap?.scopes ?? {}),
          ...(userMap?.scopes ?? {}),
        },
      };
    }
  }

  return merged;
}

class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

/**
 * Check if the adapter is using a virtual filesystem (e.g., Veryfront API)
 * Supports both single-project (VeryfrontFSAdapter) and multi-project (MultiProjectFSAdapter) modes
 */
function isVirtualFilesystem(adapter: RuntimeAdapter): boolean {
  const wrappedAdapter = (adapter?.fs as { fsAdapter?: unknown })?.fsAdapter;
  const adapterName = (wrappedAdapter as { constructor?: { name?: string } })?.constructor?.name;
  return adapterName === "VeryfrontFSAdapter" || adapterName === "MultiProjectFSAdapter";
}

/**
 * Load config from virtual filesystem by transpiling TypeScript content
 */
async function loadConfigFromVirtualFS(
  configPath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<VeryfrontConfig | null> {
  const fs = createFileSystem();

  // Read config content via adapter
  const content = await adapter.fs.readFile(configPath);
  const source = typeof content === "string" ? content : new TextDecoder().decode(content);

  serverLogger.debug(`[CONFIG] Loading config from virtual FS: ${configPath}`);

  // Determine loader based on extension
  const isTsx = configPath.endsWith(".tsx");
  const loader = isTsx ? "tsx" : configPath.endsWith(".ts") ? "ts" : "js";

  // Transpile TypeScript to JavaScript using esbuild
  const { build } = await import("esbuild");

  const result = await build({
    bundle: false, // Config files shouldn't need bundling
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    stdin: {
      contents: source,
      loader,
      resolveDir: dirname(configPath),
      sourcefile: configPath,
    },
  });

  if (result.errors && result.errors.length > 0) {
    const first = result.errors[0]?.text || "unknown error";
    throw new ConfigValidationError(`Failed to transpile config: ${first}`);
  }

  const js = result.outputFiles?.[0]?.text ?? "export default {}";

  // Write to temp file and import
  const tempDir = await fs.makeTempDir({ prefix: "vf-config-" });
  const tempFile = join(tempDir, "config.mjs");

  try {
    await fs.writeTextFile(tempFile, js);
    const configModule = await import(`file://${tempFile}?v=${Date.now()}`);
    const userConfig = configModule.default || configModule;

    if (userConfig === null || typeof userConfig !== "object" || Array.isArray(userConfig)) {
      throw new ConfigValidationError(
        `Expected object, received ${userConfig === null ? "null" : typeof userConfig}`,
      );
    }

    validateCorsConfig(userConfig);
    validateConfigShape(userConfig);

    const merged = mergeConfigs(userConfig);
    configCacheByProject.set(projectDir, { revision: cacheRevision, config: merged });
    return merged;
  } finally {
    await fs.remove(tempDir, { recursive: true });
  }
}

async function loadAndMergeConfig(
  configPath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<VeryfrontConfig | null> {
  // Check if using virtual filesystem
  if (isVirtualFilesystem(adapter)) {
    return loadConfigFromVirtualFS(configPath, projectDir, adapter);
  }

  // Local filesystem - use direct import
  try {
    const configUrl = `file://${configPath}?t=${Date.now()}-${crypto.randomUUID()}`;
    const configModule = await import(configUrl);
    const userConfig = configModule.default || configModule;

    if (userConfig === null || typeof userConfig !== "object" || Array.isArray(userConfig)) {
      throw new ConfigValidationError(
        `Expected object, received ${userConfig === null ? "null" : typeof userConfig}`,
      );
    }

    validateCorsConfig(userConfig);
    validateConfigShape(userConfig);

    const merged = mergeConfigs(userConfig);
    configCacheByProject.set(projectDir, { revision: cacheRevision, config: merged });
    return merged;
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      throw error;
    }

    if (error instanceof Error && error.message.startsWith("Invalid veryfront.config")) {
      throw error;
    }

    throw error;
  }
}

export async function getConfig(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<VeryfrontConfig> {
  const cached = configCacheByProject.get(projectDir);
  if (cached && cached.revision === cacheRevision) return cached.config;

  const configFiles = ["veryfront.config.js", "veryfront.config.ts", "veryfront.config.mjs"];

  for (const configFile of configFiles) {
    const configPath = join(projectDir, configFile);

    const exists = await adapter.fs.exists(configPath);
    if (!exists) continue;

    try {
      const merged = await loadAndMergeConfig(configPath, projectDir, adapter);
      if (merged) return merged;
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        throw error;
      }

      if (error instanceof Error && error.message.startsWith("Invalid veryfront.config")) {
        throw error;
      }

      // Only log at debug level - this is expected when .ts exists but .js is tried first
      const errorMessage = error instanceof Error ? error.message : String(error);
      serverLogger.debug(`[CONFIG] Failed to load ${configFile}, trying next config file:`, {
        error: errorMessage,
      });

      continue;
    }
  }

  const defaultConfig = DEFAULT_CONFIG as VeryfrontConfig;
  configCacheByProject.set(projectDir, { revision: cacheRevision, config: defaultConfig });
  return defaultConfig;
}

export function clearConfigCache() {
  configCacheByProject.clear();
  cacheRevision++;
}
