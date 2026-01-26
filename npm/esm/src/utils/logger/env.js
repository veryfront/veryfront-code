import * as dntShim from "../../../_dnt.shims.js";
import { hasDenoRuntime, hasNodeProcess } from "../runtime-guards.js";
export function getEnvironmentVariable(name) {
    try {
        if (hasDenoRuntime(dntShim.dntGlobalThis)) {
            const value = dntShim.dntGlobalThis.Deno?.env.get(name);
            return value || undefined;
        }
        if (hasNodeProcess(dntShim.dntGlobalThis)) {
            const value = dntShim.dntGlobalThis.process?.env[name];
            return value || undefined;
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}
export function isTestEnvironment() {
    return getEnvironmentVariable("NODE_ENV") === "test";
}
export function isProductionEnvironment() {
    return getEnvironmentVariable("NODE_ENV") === "production";
}
export function isDevelopmentEnvironment() {
    return (getEnvironmentVariable("NODE_ENV") ?? "development") === "development";
}
