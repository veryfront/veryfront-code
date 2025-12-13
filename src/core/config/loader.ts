import type { VeryfrontConfig } from "./types.ts";
import { findUnknownTopLevelKeys, validateVeryfrontConfig } from "./schema.ts";
import { join } from "std/path/mod.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { serverLogger } from "@veryfront/utils/logger/logger.ts";
import { getReactImportMap, REACT_DEFAULT_VERSION } from "@veryfront/utils/constants/cdn.ts";
import { DEFAULT_CACHE_DIR } from "@veryfront/utils/constants/server.ts";
import { DEFAULT_PORT } from "./defaults.ts";

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

async function loadAndMergeConfig(
  configPath: string,
  projectDir: string,
): Promise<VeryfrontConfig | null> {
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
    // Re-throw all errors - let caller handle them
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
      const merged = await loadAndMergeConfig(configPath, projectDir);
      if (merged) return merged;
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        throw error;
      }

      if (error instanceof Error && error.message.startsWith("Invalid veryfront.config")) {
        throw error;
      }

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
