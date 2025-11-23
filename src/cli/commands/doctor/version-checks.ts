import type { DiagnosticResult } from "./types.ts";

/**
 * Check Deno version compatibility
 * Minimum recommended version: 1.40.0
 */
export function checkDenoVersion(): Promise<DiagnosticResult> {
  try {
    const denoVersion = Deno.version.deno;
    if (denoVersion >= "1.40.0") {
      return Promise.resolve({
        name: "Deno Version",
        status: "pass",
        message: `Deno ${denoVersion}`,
      });
    } else {
      return Promise.resolve({
        name: "Deno Version",
        status: "warn",
        message: `Deno ${denoVersion} (recommended: 1.40.0+)`,
      });
    }
  } catch (_error) {
    return Promise.resolve({
      name: "Deno Version",
      status: "fail",
      message: "Could not detect Deno version",
    });
  }
}

/**
 * Check React compatibility and version detection
 */
export async function checkReactCompatibility(): Promise<DiagnosticResult> {
  try {
    const { getReactVersionInfo } = await import(
      "@veryfront/runtime/react/version-detector/index.ts"
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
