import type { DiagnosticResult } from "./types.ts";
import { getRuntimeVersion } from "../../../platform/compat/process.ts";

export function checkDenoVersion(): Promise<DiagnosticResult> {
  try {
    const runtimeVersion = getRuntimeVersion();

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

    if (runtimeVersion.startsWith("Bun")) {
      return Promise.resolve({
        name: "Runtime Version",
        status: "pass",
        message: runtimeVersion,
      });
    }

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
