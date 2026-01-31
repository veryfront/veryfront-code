import type { GlobalWithDeno, GlobalWithProcess } from "../runtime-guards.ts";
import { hasDenoRuntime, hasNodeProcess } from "../runtime-guards.ts";

export function getEnvironmentVariable(name: string): string | undefined {
  try {
    if (hasDenoRuntime(globalThis)) {
      return (globalThis as GlobalWithDeno).Deno?.env.get(name) || undefined;
    }

    if (hasNodeProcess(globalThis)) {
      return (globalThis as GlobalWithProcess).process?.env[name] || undefined;
    }

    return undefined;
  } catch {
    return undefined;
  }
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
