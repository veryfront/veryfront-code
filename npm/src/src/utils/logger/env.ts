import * as dntShim from "../../../_dnt.shims.js";
import type { GlobalWithDeno, GlobalWithProcess } from "../runtime-guards.js";
import { hasDenoRuntime, hasNodeProcess } from "../runtime-guards.js";

export function getEnvironmentVariable(name: string): string | undefined {
  try {
    if (hasDenoRuntime(dntShim.dntGlobalThis)) {
      const value = (dntShim.dntGlobalThis as GlobalWithDeno).Deno?.env.get(name);
      return value || undefined;
    }

    if (hasNodeProcess(dntShim.dntGlobalThis)) {
      const value = (dntShim.dntGlobalThis as GlobalWithProcess).process?.env[name];
      return value || undefined;
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
