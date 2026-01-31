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
 * For compiled binaries, the path structure is:
 *   /extraction_root/deno-compile-xxx/Original/Path/To/veryfront-renderer/src/...
 *
 * We need to extract the original path (/Original/Path/To/veryfront-renderer)
 * because embedded files are accessible via their original paths at runtime.
 */
export function getFrameworkRoot(filePath: string): string {
  const denoCompileMatch = filePath.match(/^(.*[/\\]deno-compile-[^/\\]+)[/\\]/);
  if (denoCompileMatch && denoCompileMatch[1]) {
    const extractionRoot = denoCompileMatch[1];
    // The path after extraction root preserves the original structure
    // e.g., Users/koji/path/veryfront-renderer/src/transforms/...
    const afterExtraction = filePath.slice(extractionRoot.length + 1);

    // Find /src/ in the remaining path to get the framework root
    const srcMatch = afterExtraction.match(/^(.*?)[/\\]src[/\\]/);
    if (srcMatch && srcMatch[1]) {
      // Return the original absolute path (prepend /)
      return "/" + srcMatch[1];
    }

    // If no /src/ found, fall back to extraction root (shouldn't happen for framework code)
    return extractionRoot;
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
