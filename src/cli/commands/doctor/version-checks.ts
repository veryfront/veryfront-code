import type { DiagnosticResult } from "./types.ts";
import { getRuntimeVersion } from "../../../platform/compat/process.ts";

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
      if (versionNum >= "1.40.0") {
        return Promise.resolve({
          name: "Runtime Version",
          status: "pass",
          message: runtimeVersion,
        });
      } else {
        return Promise.resolve({
          name: "Runtime Version",
          status: "warn",
          message: `${runtimeVersion} (recommended: Deno 1.40.0+)`,
        });
      }
    }

    // Node.js runtime check
    if (runtimeVersion.startsWith("Node.js")) {
      const versionNum = runtimeVersion.replace("Node.js v", "");
      const major = parseInt(versionNum.split(".")[0] || "0", 10);
      if (major >= 18) {
        return Promise.resolve({
          name: "Runtime Version",
          status: "pass",
          message: runtimeVersion,
        });
      } else {
        return Promise.resolve({
          name: "Runtime Version",
          status: "warn",
          message: `${runtimeVersion} (recommended: Node.js 18+)`,
        });
      }
    }

    // Bun runtime check
    if (runtimeVersion.startsWith("Bun")) {
      return Promise.resolve({
        name: "Runtime Version",
        status: "pass",
        message: runtimeVersion,
      });
    }

    // Unknown runtime
    return Promise.resolve({
      name: "Runtime Version",
      status: "pass",
      message: runtimeVersion,
    });
  } catch (_error) {
    return Promise.resolve({
      name: "Runtime Version",
      status: "fail",
      message: "Could not detect runtime version",
    });
  }
}

/**
 * Check React compatibility and version detection
 */
export async function checkReactCompatibility(): Promise<DiagnosticResult> {
  try {
    const { getReactVersionInfo } = await import(
      "../../../react/compat/version-detector/index.ts"
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
