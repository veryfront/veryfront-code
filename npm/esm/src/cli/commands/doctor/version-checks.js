import { getRuntimeVersion } from "../../../platform/compat/process.js";
function createRuntimeResult(status, message) {
    return { name: "Runtime Version", status, message };
}
export function checkDenoVersion() {
    try {
        const runtimeVersion = getRuntimeVersion();
        if (runtimeVersion.startsWith("Deno")) {
            const versionNum = runtimeVersion.replace("Deno ", "");
            const isSupported = versionNum >= "1.40.0";
            const message = isSupported
                ? runtimeVersion
                : `${runtimeVersion} (recommended: Deno 1.40.0+)`;
            return Promise.resolve(createRuntimeResult(isSupported ? "pass" : "warn", message));
        }
        if (runtimeVersion.startsWith("Node.js")) {
            const versionNum = runtimeVersion.replace("Node.js v", "");
            const major = parseInt(versionNum.split(".")[0] ?? "0", 10);
            const isSupported = major >= 18;
            const message = isSupported ? runtimeVersion : `${runtimeVersion} (recommended: Node.js 18+)`;
            return Promise.resolve(createRuntimeResult(isSupported ? "pass" : "warn", message));
        }
        return Promise.resolve(createRuntimeResult("pass", runtimeVersion));
    }
    catch {
        return Promise.resolve(createRuntimeResult("fail", "Could not detect runtime version"));
    }
}
export async function checkReactCompatibility() {
    try {
        const { getReactVersionInfo } = await import("../../../react/compat/version-detector/index.js");
        const reactInfo = getReactVersionInfo();
        const featureCount = Object.values(reactInfo.features).filter(Boolean).length;
        return {
            name: "React Compatibility",
            status: "pass",
            message: `React ${reactInfo.version} (${featureCount} features)`,
        };
    }
    catch (error) {
        return {
            name: "React Compatibility",
            status: "warn",
            message: "React detection failed",
            details: error instanceof Error ? error.message : String(error),
        };
    }
}
