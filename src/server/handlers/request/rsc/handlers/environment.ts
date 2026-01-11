import { getEnv } from "@veryfront/platform/compat/process.ts";

export function isProductionMode(): boolean {
  const denoEnv = getEnv("DENO_ENV");
  const nodeEnv = getEnv("NODE_ENV");
  return denoEnv === "production" || nodeEnv === "production";
}
