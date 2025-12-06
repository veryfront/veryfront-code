import { getEnv } from "../../../../../platform/compat/process.ts";

export function isProductionMode(): boolean {
  try {
    return getEnv("DENO_ENV") === "production" || getEnv("NODE_ENV") === "production";
  } catch {
    // ignore
  }
  return false;
}
