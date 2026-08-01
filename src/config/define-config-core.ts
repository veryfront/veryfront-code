import type { VeryfrontConfig, VeryfrontConfigInput } from "./schemas/index.ts";

/** Define a Veryfront project configuration object. */
export function defineConfig<const T extends VeryfrontConfigInput>(config: T): T {
  return config;
}

/** Apply a configuration factory to an already resolved environment name. */
export function defineConfigForEnvironment<const T extends VeryfrontConfigInput>(
  factory: (env: string) => T,
  environmentName: string,
): T {
  return factory(environmentName);
}

/** Merge multiple partial Veryfront configuration objects into one config object. */
export function mergeConfigs(...configs: Partial<VeryfrontConfig>[]): VeryfrontConfig;
export function mergeConfigs(...configs: Partial<VeryfrontConfigInput>[]): VeryfrontConfigInput;
export function mergeConfigs(
  ...configs: Partial<VeryfrontConfigInput>[]
): VeryfrontConfigInput {
  return Object.assign({}, ...configs);
}
