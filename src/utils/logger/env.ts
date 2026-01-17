import type { GlobalWithDeno, GlobalWithProcess } from "../runtime-guards.ts";
import { hasDenoRuntime, hasNodeProcess } from "../runtime-guards.ts";

export function getEnvironmentVariable(name: string): string | undefined {
  try {
    if (typeof Deno !== "undefined" && hasDenoRuntime(globalThis)) {
      const value = (globalThis as GlobalWithDeno).Deno?.env.get(name);
      return value === "" ? undefined : value;
    }
    if (hasNodeProcess(globalThis)) {
      const value = (globalThis as GlobalWithProcess).process?.env[name];
      return value === "" ? undefined : value;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function isTestEnvironment(): boolean {
  return getEnvironmentVariable("NODE_ENV") === "test";
}

export function isProductionEnvironment(): boolean {
  return getEnvironmentVariable("NODE_ENV") === "production";
}

export function isDevelopmentEnvironment(): boolean {
  return (getEnvironmentVariable("NODE_ENV") ?? "development") === "development";
}
