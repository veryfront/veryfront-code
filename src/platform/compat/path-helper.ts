import nodePath from "node:path";
import type { PlatformPath } from "node:path";

let pathMod: PlatformPath | null = null;

// @ts-ignore - Deno global
if (typeof Deno === "undefined") {
  pathMod = nodePath;
} else {
  // @ts-ignore - Deno global
  import("std/path/mod.ts").then((mod) => {
    pathMod = mod as unknown as PlatformPath;
  });
}

function getPathMod(): PlatformPath {
  if (pathMod) return pathMod;
  return nodePath;
}

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
  const urlObj = typeof url === "string" ? new URL(url) : url;
  return urlObj.pathname;
};
export const join = (...paths: string[]): string => getPathMod().join(...paths);
export const relative = (from: string, to: string): string => getPathMod().relative(from, to);
export const resolve = (...paths: string[]): string => getPathMod().resolve(...paths);
export const extname = (path: string): string => getPathMod().extname(path);
export const isAbsolute = (path: string): boolean => getPathMod().isAbsolute(path);
export const sep: string = nodePath.sep;
