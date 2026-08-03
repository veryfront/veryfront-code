import type { VeryfrontConfigInput } from "./schemas/index.ts";
import { type EnvironmentConfig, getEnvironmentConfig } from "./environment-config.ts";
import { defineConfigForEnvironment } from "./define-config-core.ts";

export { defineConfig, mergeConfigs } from "./define-config-core.ts";

/** Define a Veryfront project configuration from the current environment name. */
export function defineConfigWithEnv<const T extends VeryfrontConfigInput>(
  factory: (env: string) => T,
  envConfig: Pick<EnvironmentConfig, "nodeEnv"> = getEnvironmentConfig(),
): T {
  return defineConfigForEnvironment(factory, envConfig.nodeEnv);
}
