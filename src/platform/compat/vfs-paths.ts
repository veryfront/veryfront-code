/**
 * VFS path utilities for compiled Deno binaries.
 *
 * In compiled binaries, import.meta.url resolves to embedded paths like
 * /tmp/deno-compile-xyz/Users/original/path/src/... which preserve the original
 * absolute path structure after the extraction root. These utilities handle
 * path resolution across both dev and compiled contexts.
 *
 * Key insight: Deno compile with --include embeds files with their original
 * absolute paths, and those files are accessible via those original paths
 * at runtime (Deno's VFS maps them transparently).
 */

/**
 * Get the framework root directory from a file path.
 * Handles both dev paths and compiled binary VFS paths.
 *
 * For compiled binaries, files are embedded with --include and extracted to:
 *   /tmp/deno-compile-xxx/{relative_path_from_include}
 *
 * The extraction root IS the framework root because --include paths are
 * relative to the project root. So dist/framework-src extracts to
 * /tmp/deno-compile-xxx/dist/framework-src.
 */
export function getFrameworkRoot(filePath: string): string {
  const denoCompileMatch = filePath.match(/^(.*[/\\]deno-compile-[^/\\]+)[/\\]/);
  if (denoCompileMatch && denoCompileMatch[1]) {
    // For compiled binaries, always return the extraction root.
    // Files included with --include are placed relative to the extraction root,
    // matching their original relative paths from the compile command's CWD.
    // This means dist/framework-src is at {extraction_root}/dist/framework-src.
    return denoCompileMatch[1];
  }

  // Dev mode: find the last /src/ and return the path before it
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
