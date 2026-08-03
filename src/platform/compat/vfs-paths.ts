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

import { fileURLToPath } from "node:url";

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
  const portablePath = filePath.replace(/\\/g, "/");
  const denoCompileMatch = portablePath.match(/^(.*\/deno-compile-[^/]+)\//);
  if (denoCompileMatch?.[1]) {
    // For compiled binaries, always return the extraction root.
    // Files included with --include are placed relative to the extraction root,
    // matching their original relative paths from the compile command's CWD.
    // This means dist/framework-src is at {extraction_root}/dist/framework-src.
    return denoCompileMatch[1];
  }

  const parts = portablePath.split("/");
  let frameworkSourceIndex = -1;
  for (let index = parts.length - 1; index > 0; index--) {
    const part = parts[index];
    if (
      part === "src" ||
      (part === "dist" && parts[index + 1] === "framework-src")
    ) {
      frameworkSourceIndex = index;
      break;
    }
  }
  if (frameworkSourceIndex > 0) {
    return parts.slice(0, frameworkSourceIndex).join("/");
  }

  // Published packages execute from dist rather than src.
  const distIndex = parts.lastIndexOf("dist");
  if (distIndex > 0) return parts.slice(0, distIndex).join("/");

  return "";
}

/**
 * Get the framework root from import.meta.url.
 * Convenience wrapper for module-level initialization.
 */
export function getFrameworkRootFromMeta(importMetaUrl: string): string {
  const filePath = fileURLToPath(importMetaUrl);
  const root = getFrameworkRoot(filePath);
  if (root) return root;

  throw new Error(
    `Cannot determine framework root from module URL: ${importMetaUrl}`,
  );
}

/** Testable version for unit tests. */
export function testGetFrameworkRoot(filePath: string): string {
  return getFrameworkRoot(filePath);
}
