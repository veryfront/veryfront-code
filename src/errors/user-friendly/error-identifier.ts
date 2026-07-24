import { snapshotVeryfrontError } from "../types.ts";
import { getErrorMessage, isErrorInstance, snapshotError } from "../veryfront-error.ts";

const REGISTERED_ERROR_SOLUTIONS: Readonly<Record<string, string>> = Object.freeze({
  "config-not-found": "missing-config",
  "config-invalid": "invalid-config",
  "config-parse-error": "invalid-config",
  "config-validation-error": "invalid-config",
  "config-validation-failed": "invalid-config",
  "config-type-error": "invalid-config",
  "invalid-route-file": "invalid-route",
  "route-handler-invalid": "invalid-route",
  "client-boundary-violation": "client-boundary",
  "server-only-in-client": "client-boundary",
  "client-only-in-server": "client-boundary",
  "module-not-found": "import-not-found",
  "import-resolution-error": "import-not-found",
  "port-in-use": "port-in-use",
  "build-failed": "build-failed",
  "dependency-missing": "missing-deps",
});

export function identifyError(error: Error): string {
  const snapshot = snapshotVeryfrontError(error);
  if (snapshot) {
    if (Object.hasOwn(REGISTERED_ERROR_SOLUTIONS, snapshot.slug)) {
      return REGISTERED_ERROR_SOLUTIONS[snapshot.slug]!;
    }
  }

  const nativeSnapshot = snapshot ? null : snapshotError(error);
  const message = (
    snapshot?.message ??
      nativeSnapshot?.message ??
      (isErrorInstance(error) ? "Unknown error" : getErrorMessage(error))
  ).toLowerCase();

  if (message.includes("veryfront.config") && message.includes("not found")) {
    return "missing-config";
  }

  if (message.includes("config") && (message.includes("invalid") || message.includes("parse"))) {
    return "invalid-config";
  }

  if (message.includes("route") && (message.includes("invalid") || message.includes("export"))) {
    return "invalid-route";
  }

  if (message.includes("client") && (message.includes("boundary") || message.includes("server"))) {
    return "client-boundary";
  }

  if (message.includes("port") && (message.includes("in use") || message.includes("eaddrinuse"))) {
    return "port-in-use";
  }

  if (message.includes("build") && message.includes("fail")) {
    return "build-failed";
  }

  if (message.includes("react") && message.includes("not found")) {
    return "missing-deps";
  }

  if (
    message.includes("import") ||
    message.includes("module not found") ||
    message.includes("resolve")
  ) {
    return "import-not-found";
  }

  return "unknown";
}
