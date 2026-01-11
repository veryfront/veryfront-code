import type { VeryfrontConfig } from "./types.ts";
import { createError, toError } from "@veryfront/errors/veryfront-error.ts";
import { getEnv } from "@veryfront/platform/compat/process.ts";

export function defineConfig(config: VeryfrontConfig): VeryfrontConfig {
  return config;
}

export function defineConfigWithEnv(
  factory: (env: string) => VeryfrontConfig,
): VeryfrontConfig {
  const env = getEnv("NODE_ENV") || "development";
  return factory(env);
}

export function mergeConfigs(
  ...configs: Partial<VeryfrontConfig>[]
): VeryfrontConfig {
  const merged: Partial<VeryfrontConfig> = {};

  for (const config of configs) {
    Object.assign(merged, config);
  }

  return merged as VeryfrontConfig;
}

export async function validateConfig(config: unknown): Promise<void> {
  if (!config || typeof config !== "object") {
    throw toError(createError({
      type: "config",
      message: "Configuration must be an object",
    }));
  }

  const cfg = config as Record<string, unknown>;

  if (cfg.dev && typeof cfg.dev === "object") {
    const dev = cfg.dev as Record<string, unknown>;
    if (dev.port !== undefined) {
      const { MIN_PORT, MAX_PORT } = await import("../utils/constants/network.ts");
      if (typeof dev.port !== "number" || dev.port < MIN_PORT || dev.port > MAX_PORT) {
        throw toError(createError({
          type: "config",
          message: `dev.port must be a number between ${MIN_PORT} and ${MAX_PORT}`,
          context: {
            field: "dev.port",
            value: dev.port,
            expected: `number between ${MIN_PORT} and ${MAX_PORT}`,
          },
        }));
      }
    }
  }

  if (cfg.build && typeof cfg.build === "object") {
    const build = cfg.build as Record<string, unknown>;
    if (build.outDir !== undefined && typeof build.outDir !== "string") {
      throw toError(createError({
        type: "config",
        message: "build.outDir must be a string",
        context: { field: "build.outDir", value: build.outDir, expected: "string" },
      }));
    }
  }
}
