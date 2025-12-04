// Conditional imports for path module
import nodePath from "node:path";
import type { PlatformPath } from "node:path";

// Use node:path for Node.js or import Deno's std/path for Deno
let pathMod: PlatformPath | null = null;
let denoPathPromise: Promise<PlatformPath> | null = null;

// Initialize path module synchronously for Node.js
// @ts-ignore - Deno global
if (typeof Deno === "undefined") {
  pathMod = nodePath;
} else {
  // Deno environment - start loading asynchronously but don't await
  // @ts-ignore - Deno global
  denoPathPromise = import("std/path/mod.ts").then((mod) => {
    pathMod = mod as unknown as PlatformPath;
    return pathMod;
  });
}

// Helper to get path module, ensuring it's loaded
function getPathMod(): PlatformPath {
  if (pathMod) return pathMod;
  // In Deno, if pathMod is not yet loaded, use Node.js path as temporary fallback
  // This should rarely happen as the import is fast
  return nodePath;
}

// Re-export common path functions with proper types
export const basename = (path: string, suffix?: string): string =>
  getPathMod().basename(path, suffix);
export const dirname = (path: string): string => getPathMod().dirname(path);
export const fromFileUrl = (url: string | URL): string => {
  const mod = getPathMod();
  // @ts-ignore - Deno path module has fromFileUrl
  if (mod && typeof (mod as any).fromFileUrl === "function") {
    // @ts-ignore - Deno path module has fromFileUrl
    return (mod as any).fromFileUrl(url);
  }
  // Fallback for Node.js where fromFileUrl might not be directly available
  // This uses URL parsing which is generally cross-platform
  const urlObj = typeof url === "string" ? new URL(url) : url;
  return urlObj.pathname;
};
export const join = (...paths: string[]): string => getPathMod().join(...paths);
export const relative = (from: string, to: string): string => getPathMod().relative(from, to);
export const resolve = (...paths: string[]): string => getPathMod().resolve(...paths);
export const extname = (path: string): string => getPathMod().extname(path);
export const isAbsolute = (path: string): boolean => getPathMod().isAbsolute(path);
// Export sep - uses getter function to ensure pathMod is resolved
export const sep: string = nodePath.sep;
