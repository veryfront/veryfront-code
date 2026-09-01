import { posix } from "#veryfront/compat/path";

const VF_MODULE_ROOT = "_vf_modules";
const VF_MODULE_PREFIX = `${VF_MODULE_ROOT}/`;

/**
 * Return the framework-relative source key for a `_veryfront/` module path,
 * or null when the path does not address framework source.
 */
export function frameworkSourceKeyOf(modulePath: string): string | null {
  const withoutVfModules = modulePath.startsWith(VF_MODULE_PREFIX)
    ? modulePath.slice(VF_MODULE_PREFIX.length)
    : modulePath;
  if (!withoutVfModules.startsWith("_veryfront/")) return null;
  return withoutVfModules.slice("_veryfront/".length);
}

/**
 * Canonicalize a module path only when it remains project-relative and, when
 * rooted in `_vf_modules`, remains below that virtual root.
 */
export function canonicalizeContainedModulePath(modulePath: string): string | null {
  const candidate = modulePath
    .replace(/\?.*$/, "")
    .replace(/^\/+/, "");

  if (
    !candidate ||
    candidate.includes("\\") ||
    candidate.includes("\0") ||
    /^[A-Za-z]:/.test(candidate)
  ) {
    return null;
  }

  const normalized = posix.normalize(candidate);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    posix.isAbsolute(normalized)
  ) {
    return null;
  }

  const wasVfModulePath = candidate === VF_MODULE_ROOT || candidate.startsWith(VF_MODULE_PREFIX);
  if (
    wasVfModulePath &&
    normalized !== VF_MODULE_ROOT &&
    !normalized.startsWith(VF_MODULE_PREFIX)
  ) {
    return null;
  }

  return normalized;
}

export function isVfModulePath(modulePath: string): boolean {
  return modulePath === VF_MODULE_ROOT || modulePath.startsWith(VF_MODULE_PREFIX);
}
