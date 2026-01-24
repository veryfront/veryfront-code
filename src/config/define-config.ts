import type { VeryfrontConfig } from "./types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { getRuntimeEnv, type RuntimeEnv } from "./runtime-env.ts";

export function defineConfig(config: VeryfrontConfig): VeryfrontConfig {
  return config;
}

export function defineConfigWithEnv(
  factory: (env: string) => VeryfrontConfig,
  runtimeEnv: RuntimeEnv = getRuntimeEnv(),
): VeryfrontConfig {
  return factory(runtimeEnv.nodeEnv);
}

export function mergeConfigs(...configs: Partial<VeryfrontConfig>[]): VeryfrontConfig {
  return Object.assign({}, ...configs) as VeryfrontConfig;
}

export async function validateConfig(config: unknown): Promise<void> {
  if (!config || typeof config !== "object") {
    throw toError(
      createError({
        type: "config",
        message: "Configuration must be an object",
      }),
    );
  }

  const cfg = config as Record<string, unknown>;
  const dev = cfg.dev;

  if (dev && typeof dev === "object") {
    const port = (dev as Record<string, unknown>).port;

    if (port !== undefined) {
      const { MIN_PORT, MAX_PORT } = await import("../utils/constants/network.ts");

      if (typeof port !== "number" || port < MIN_PORT || port > MAX_PORT) {
        throw toError(
          createError({
            type: "config",
            message: `dev.port must be a number between ${MIN_PORT} and ${MAX_PORT}`,
            context: {
              field: "dev.port",
              value: port,
              expected: `number between ${MIN_PORT} and ${MAX_PORT}`,
            },
          }),
        );
      }
    }
  }

  const build = cfg.build;

  if (build && typeof build === "object") {
    const outDir = (build as Record<string, unknown>).outDir;

    if (outDir !== undefined && typeof outDir !== "string") {
      throw toError(
        createError({
          type: "config",
          message: "build.outDir must be a string",
          context: { field: "build.outDir", value: outDir, expected: "string" },
        }),
      );
    }
  }
}
