/**
 * VFS path utilities for compiled Deno binaries.
 *
 * In compiled binaries, import.meta.url resolves to embedded paths like
 * /tmp/deno-compile-xyz/src/... which don't map directly to filesystem paths.
 * These utilities handle path resolution across both dev and compiled contexts.
 */

/**
 * Get the framework root directory from a file path.
 * Handles both dev paths and compiled binary VFS paths.
 */
export function getFrameworkRoot(filePath: string): string {
  // Check for deno-compile VFS pattern first
  const denoCompileMatch = filePath.match(/^(.*[/\\]deno-compile-[^/\\]+)[/\\]/);
  if (denoCompileMatch?.[1]) {
    return denoCompileMatch[1];
  }

  // Fall back to finding src/ directory and returning its parent
  const normalizedPath = filePath.replace(/\\/g, "/");
  const parts = normalizedPath.split("/");
  const srcIndex = parts.lastIndexOf("src");
  if (srcIndex > 0) {
    return parts.slice(0, srcIndex).join("/");
  }

  // Last resort: return empty string (caller should handle)
  return "";
}

/**
 * Get the framework root from import.meta.url.
 * Convenience wrapper for module-level initialization.
 */
export function getFrameworkRootFromMeta(importMetaUrl: string): string {
  const filePath = new URL(importMetaUrl).pathname;
  const root = getFrameworkRoot(filePath);

  // If we couldn't determine root, fall back to relative resolution
  if (!root) {
    // Go up from typical src/some/nested/module.ts structure
    return new URL("../../..", importMetaUrl).pathname;
  }

  return root;
}

/** Testable version for unit tests. */
export function testGetFrameworkRoot(filePath: string): string {
  return getFrameworkRoot(filePath);
}
