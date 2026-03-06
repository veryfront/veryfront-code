import type { VeryfrontConfig } from "./schemas/index.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { type EnvironmentConfig, getEnvironmentConfig } from "./environment-config.ts";

export function defineConfig(config: VeryfrontConfig): VeryfrontConfig {
  return config;
}

export function defineConfigWithEnv(
  factory: (env: string) => VeryfrontConfig,
  envConfig: EnvironmentConfig = getEnvironmentConfig(),
): VeryfrontConfig {
  return factory(envConfig.nodeEnv);
}

export function mergeConfigs(...configs: Partial<VeryfrontConfig>[]): VeryfrontConfig {
  return Object.assign({}, ...configs) as VeryfrontConfig;
}

export async function validateConfig(config: unknown): Promise<void> {
  if (!config || typeof config !== "object") {
    throw toError(
      createError({ type: "config", message: "Configuration must be an object" }),
    );
  }

  const cfg = config as Record<string, unknown>;

  await validatePort(cfg);
  validateOutDir(cfg);
}

async function validatePort(cfg: Record<string, unknown>): Promise<void> {
  const dev = cfg.dev;
  const port = dev && typeof dev === "object" ? (dev as Record<string, unknown>).port : undefined;
  if (port === undefined) return;

  const { MIN_PORT, MAX_PORT } = await import("../utils/constants/index.ts");
  if (typeof port === "number" && port >= MIN_PORT && port <= MAX_PORT) return;

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

function validateOutDir(cfg: Record<string, unknown>): void {
  const build = cfg.build;
  const outDir = build && typeof build === "object"
    ? (build as Record<string, unknown>).outDir
    : undefined;
  if (outDir === undefined || typeof outDir === "string") return;

  throw toError(
    createError({
      type: "config",
      message: "build.outDir must be a string",
      context: { field: "build.outDir", value: outDir, expected: "string" },
    }),
  );
}
