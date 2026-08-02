import { getEnv } from "#veryfront/platform/compat/process/env.ts";
import type { VeryfrontConfigInput } from "./schemas/index.ts";
import { defineConfigForEnvironment } from "./define-config-core.ts";

export { defineConfig, mergeConfigs } from "./define-config-core.ts";

type ClientEnvironmentConfig = {
  nodeEnv: string;
};

function readClientEnvironmentConfig(): ClientEnvironmentConfig {
  return {
    nodeEnv: getEnv("NODE_ENV") ?? getEnv("DENO_ENV") ?? "development",
  };
}

/** Define a Veryfront project configuration from the current environment name. */
export function defineConfigWithEnv<const T extends VeryfrontConfigInput>(
  factory: (env: string) => T,
  envConfig: ClientEnvironmentConfig = readClientEnvironmentConfig(),
): T {
  return defineConfigForEnvironment(factory, envConfig.nodeEnv);
}
