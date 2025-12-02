// Conditional imports for path module
import nodePath from "node:path";
import type { PlatformPath } from "node:path";

// Use node:path for Node.js or import Deno's std/path for Deno
let pathMod: PlatformPath;

// @ts-ignore - Deno global
if (typeof Deno === 'undefined') {
  pathMod = nodePath;
} else {
  // @ts-ignore - Deno global - dynamically imported
  const denoPath = await import("std/path/mod.ts");
  pathMod = denoPath as unknown as PlatformPath;
}

// Re-export common path functions with proper types
export const basename = (path: string, suffix?: string): string => pathMod.basename(path, suffix);
export const dirname = (path: string): string => pathMod.dirname(path);
export const fromFileUrl = (url: string | URL): string => {
  // @ts-ignore - Deno path module has fromFileUrl
  if (pathMod && typeof (pathMod as any).fromFileUrl === 'function') {
    // @ts-ignore - Deno path module has fromFileUrl
    return (pathMod as any).fromFileUrl(url);
  }
  // Fallback for Node.js where fromFileUrl might not be directly available
  // This uses URL parsing which is generally cross-platform
  const urlObj = typeof url === 'string' ? new URL(url) : url;
  return urlObj.pathname;
};
export const join = (...paths: string[]): string => pathMod.join(...paths);
export const relative = (from: string, to: string): string => pathMod.relative(from, to);
export const resolve = (...paths: string[]): string => pathMod.resolve(...paths);
export const extname = (path: string): string => pathMod.extname(path);
export const isAbsolute = (path: string): boolean => pathMod.isAbsolute(path);
// Export sep as a getter to ensure pathMod is fully initialized
export const sep: string = pathMod.sep ?? "/";
