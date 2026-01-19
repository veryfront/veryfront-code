import type { DiagnosticResult } from "./types.ts";
import { getRuntimeVersion } from "#veryfront/platform/compat/process.ts";

/**
 * Create a diagnostic result for runtime version
 */
function createRuntimeResult(
  status: DiagnosticResult["status"],
  message: string,
): DiagnosticResult {
  return { name: "Runtime Version", status, message };
}

/**
 * Check runtime version compatibility
 * Supports Deno 1.40.0+, Node.js 18+, Bun 1.0+
 */
export function checkDenoVersion(): Promise<DiagnosticResult> {
  try {
    const runtimeVersion = getRuntimeVersion();

    // Deno runtime check
    if (runtimeVersion.startsWith("Deno")) {
      const versionNum = runtimeVersion.replace("Deno ", "");
      const isSupported = versionNum >= "1.40.0";
      return Promise.resolve(createRuntimeResult(
        isSupported ? "pass" : "warn",
        isSupported ? runtimeVersion : `${runtimeVersion} (recommended: Deno 1.40.0+)`,
      ));
    }

    // Node.js runtime check
    if (runtimeVersion.startsWith("Node.js")) {
      const versionNum = runtimeVersion.replace("Node.js v", "");
      const major = parseInt(versionNum.split(".")[0] || "0", 10);
      const isSupported = major >= 18;
      return Promise.resolve(createRuntimeResult(
        isSupported ? "pass" : "warn",
        isSupported ? runtimeVersion : `${runtimeVersion} (recommended: Node.js 18+)`,
      ));
    }

    // Bun and unknown runtimes pass by default
    return Promise.resolve(createRuntimeResult("pass", runtimeVersion));
  } catch {
    return Promise.resolve(createRuntimeResult("fail", "Could not detect runtime version"));
  }
}

/**
 * Check React compatibility and version detection
 */
export async function checkReactCompatibility(): Promise<DiagnosticResult> {
  try {
    const { getReactVersionInfo } = await import(
      "@veryfront/react/compat/version-detector/index.ts"
    );
    const reactInfo = getReactVersionInfo();
    return {
      name: "React Compatibility",
      status: "pass",
      message: `React ${reactInfo.version} (${
        Object.keys(reactInfo.features).filter(
          (key) => reactInfo.features[key as keyof typeof reactInfo.features],
        ).length
      } features)`,
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
