import { getOsType } from "#veryfront/platform/compat/process/lifecycle.ts";
import { type RuntimeKind, runtimeKind } from "#veryfront/platform/compat/runtime.ts";

/**
 * Explain a known local-JSON persistence gap for one runtime/OS pair.
 *
 * @internal Exported for deterministic support-matrix tests. This module is not
 * part of the public embedding barrel.
 */
export function getLocalJsonStoreUnsupportedDetail(
  runtime: RuntimeKind,
  operatingSystem: string,
): string | null {
  if (operatingSystem !== "windows" || (runtime !== "deno" && runtime !== "bun")) {
    return null;
  }
  const runtimeName = runtime === "deno" ? "Deno" : "Bun";
  return `The local-json RAG backend is not supported on ${runtimeName} for Windows ` +
    "because that runtime cannot provide the verified file-snapshot reads required for " +
    "safe persistence. Use Node.js on Windows or configure the veryfront-cloud backend.";
}

export function getCurrentLocalJsonStoreUnsupportedDetail(): string | null {
  return getLocalJsonStoreUnsupportedDetail(runtimeKind, getOsType());
}
