import type { VeryfrontConfig, VeryfrontConfigInput } from "./schemas/index.ts";
import { validateVeryfrontConfig } from "./schemas/index.ts";
import { CONFIG_VALIDATION_FAILED } from "#veryfront/errors/error-registry.ts";
import { type EnvironmentConfig, getEnvironmentConfig } from "./environment-config.ts";

/** Define a Veryfront project configuration object. */
export function defineConfig<const T extends VeryfrontConfigInput>(config: T): T {
  return config;
}

/** Define a Veryfront project configuration from the current environment name. */
export function defineConfigWithEnv<const T extends VeryfrontConfigInput>(
  factory: (env: string) => T,
  envConfig: EnvironmentConfig = getEnvironmentConfig(),
): T {
  return factory(envConfig.nodeEnv);
}

/** Merge multiple partial Veryfront configuration objects into one config object. */
export function mergeConfigs(...configs: Partial<VeryfrontConfig>[]): VeryfrontConfig;
/** Merge multiple user-authored configuration objects before validation. */
export function mergeConfigs(...configs: Partial<VeryfrontConfigInput>[]): VeryfrontConfigInput;
export function mergeConfigs(
  ...configs: Partial<VeryfrontConfigInput>[]
): VeryfrontConfigInput {
  return Object.assign({}, ...configs);
}

export async function validateConfig(config: unknown): Promise<void> {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw CONFIG_VALIDATION_FAILED.create({ detail: "Configuration must be an object" });
  }

  const cfg = config as Record<string, unknown>;

  await validatePort(cfg);
  validateOutDir(cfg);
  validateVeryfrontConfig(cfg);
}

async function validatePort(cfg: Record<string, unknown>): Promise<void> {
  const dev = cfg.dev;
  const port = dev && typeof dev === "object" ? (dev as Record<string, unknown>).port : undefined;
  if (port === undefined) return;

  const { MIN_PORT, MAX_PORT } = await import("../utils/constants/index.ts");
  if (
    typeof port === "number" && Number.isSafeInteger(port) && port >= MIN_PORT &&
    port <= MAX_PORT
  ) return;

  throw CONFIG_VALIDATION_FAILED.create({
    detail: `dev.port must be a number between ${MIN_PORT} and ${MAX_PORT}`,
    context: {
      field: "dev.port",
      expected: `number between ${MIN_PORT} and ${MAX_PORT}`,
    },
  });
}

function validateOutDir(cfg: Record<string, unknown>): void {
  const build = cfg.build;
  const outDir = build && typeof build === "object"
    ? (build as Record<string, unknown>).outDir
    : undefined;
  if (outDir === undefined || typeof outDir === "string") return;

  throw CONFIG_VALIDATION_FAILED.create({
    detail: "build.outDir must be a string",
    context: { field: "build.outDir", expected: "string" },
  });
}
