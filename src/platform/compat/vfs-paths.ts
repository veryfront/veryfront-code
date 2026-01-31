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
  const denoCompileMatch = filePath.match(/^(.*[/\\]deno-compile-[^/\\]+)[/\\]/);
  const denoCompileRoot = denoCompileMatch?.[1];
  if (denoCompileRoot) return denoCompileRoot;

  const parts = filePath.replace(/\\/g, "/").split("/");
  const srcIndex = parts.lastIndexOf("src");
  if (srcIndex > 0) return parts.slice(0, srcIndex).join("/");

  return "";
}

/**
 * Get the framework root from import.meta.url.
 * Convenience wrapper for module-level initialization.
 */
export function getFrameworkRootFromMeta(importMetaUrl: string): string {
  const filePath = new URL(importMetaUrl).pathname;
  const root = getFrameworkRoot(filePath);
  if (root) return root;

  // Go up from typical src/some/nested/module.ts structure
  return new URL("../../..", importMetaUrl).pathname;
}

/** Testable version for unit tests. */
export function testGetFrameworkRoot(filePath: string): string {
  return getFrameworkRoot(filePath);
}
