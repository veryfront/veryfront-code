import type { GlobalWithDeno } from "@veryfront/utils/runtime-guards.ts";
import { hasDenoRuntime } from "@veryfront/utils/runtime-guards.ts";

declare const process: { env: Record<string, string> };

export function isProductionMode(): boolean {
  try {
    if (typeof Deno !== "undefined" && hasDenoRuntime(globalThis)) {
      return (globalThis as GlobalWithDeno).Deno?.env.get("DENO_ENV") === "production";
    }
    if (typeof process !== "undefined" && process.env) {
      return process.env.DENO_ENV === "production";
    }
  } catch {
    // ignore
  }
  return false;
}
