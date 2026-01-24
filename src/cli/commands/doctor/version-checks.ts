import type { DiagnosticResult } from "./types.ts";
import { getRuntimeVersion } from "#veryfront/platform/compat/process.ts";

function createRuntimeResult(
  status: DiagnosticResult["status"],
  message: string,
): DiagnosticResult {
  return { name: "Runtime Version", status, message };
}

export function checkDenoVersion(): Promise<DiagnosticResult> {
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
  } catch {
    return Promise.resolve(createRuntimeResult("fail", "Could not detect runtime version"));
  }
}

export async function checkReactCompatibility(): Promise<DiagnosticResult> {
  try {
    const { getReactVersionInfo } = await import(
      "@veryfront/react/compat/version-detector/index.ts"
    );
    const reactInfo = getReactVersionInfo();
    const featureCount = Object.values(reactInfo.features).filter(Boolean).length;

    return {
      name: "React Compatibility",
      status: "pass",
      message: `React ${reactInfo.version} (${featureCount} features)`,
    };
  } catch (error) {
    return {
      name: "React Compatibility",
      status: "warn",
      message: "React detection failed",
      details: error instanceof Error ? error.message : String(error),
    };
  }
}
