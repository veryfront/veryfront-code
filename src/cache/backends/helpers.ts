import { runtime } from "#veryfront/platform/adapters/registry.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";

export function getEnvValue(key: string): string | undefined {
  if (runtime.isInitialized()) return runtime.getSync().env.get(key);
  return getEnv(key);
}
