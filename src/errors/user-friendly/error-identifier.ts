import { snapshotVeryfrontError } from "../types.ts";
import { getErrorMessage, isErrorInstance, snapshotError } from "../veryfront-error.ts";

const objectFreeze = Object.freeze;
const objectHasOwn = Object.hasOwn;
const reflectApply = Reflect.apply;
const stringPrototypeIncludes = String.prototype.includes;
const stringPrototypeToLowerCase = String.prototype.toLowerCase;

function includesString(value: string, search: string): boolean {
  return reflectApply(stringPrototypeIncludes, value, [search]);
}

function toLowerCaseString(value: string): string {
  return reflectApply(stringPrototypeToLowerCase, value, []);
}

const REGISTERED_ERROR_SOLUTIONS: Readonly<Record<string, string>> = objectFreeze({
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
    if (objectHasOwn(REGISTERED_ERROR_SOLUTIONS, snapshot.slug)) {
      return REGISTERED_ERROR_SOLUTIONS[snapshot.slug]!;
    }
  }

  const nativeSnapshot = snapshot ? null : snapshotError(error);
  const message = snapshot?.message ??
    nativeSnapshot?.message ??
    (isErrorInstance(error) ? "Unknown error" : getErrorMessage(error));
  const normalizedMessage = toLowerCaseString(message);

  if (
    includesString(normalizedMessage, "veryfront.config") &&
    includesString(normalizedMessage, "not found")
  ) {
    return "missing-config";
  }

  if (
    includesString(normalizedMessage, "config") &&
    (includesString(normalizedMessage, "invalid") || includesString(normalizedMessage, "parse"))
  ) {
    return "invalid-config";
  }

  if (
    includesString(normalizedMessage, "route") &&
    (includesString(normalizedMessage, "invalid") || includesString(normalizedMessage, "export"))
  ) {
    return "invalid-route";
  }

  if (
    includesString(normalizedMessage, "client") &&
    (includesString(normalizedMessage, "boundary") || includesString(normalizedMessage, "server"))
  ) {
    return "client-boundary";
  }

  if (
    includesString(normalizedMessage, "port") &&
    (includesString(normalizedMessage, "in use") ||
      includesString(normalizedMessage, "eaddrinuse"))
  ) {
    return "port-in-use";
  }

  if (includesString(normalizedMessage, "build") && includesString(normalizedMessage, "fail")) {
    return "build-failed";
  }

  if (
    includesString(normalizedMessage, "react") && includesString(normalizedMessage, "not found")
  ) {
    return "missing-deps";
  }

  if (
    includesString(normalizedMessage, "import") ||
    includesString(normalizedMessage, "module not found") ||
    includesString(normalizedMessage, "resolve")
  ) {
    return "import-not-found";
  }

  return "unknown";
}
