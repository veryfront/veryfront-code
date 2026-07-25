import type { VeryfrontConfig, VeryfrontConfigInput } from "./schemas/index.ts";
import { type EnvironmentConfig, getEnvironmentConfig } from "./environment-config.ts";

/** Define a Veryfront project configuration object. */
export function defineConfig<const T extends VeryfrontConfigInput>(config: T): T {
  return config;
}

/** Define a Veryfront project configuration from the current environment name. */
export function defineConfigWithEnv<const T extends VeryfrontConfigInput>(
  factory: (env: string) => T,
  envConfig: Pick<EnvironmentConfig, "nodeEnv"> = getEnvironmentConfig(),
): T {
  return factory(envConfig.nodeEnv);
}

/** Merge multiple partial Veryfront configuration objects into one config object. */
export function mergeConfigs(...configs: Partial<VeryfrontConfig>[]): VeryfrontConfig;
export function mergeConfigs(...configs: Partial<VeryfrontConfigInput>[]): VeryfrontConfigInput;
export function mergeConfigs(
  ...configs: Partial<VeryfrontConfigInput>[]
): VeryfrontConfigInput {
  return Object.assign({}, ...configs);
}
