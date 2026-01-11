import { hasNodePath, isDeno, nodePath } from "./runtime.ts";

export function resolve(...paths: string[]): string {
  if (!isDeno && hasNodePath) {
    return nodePath!.resolve(...paths);
  }

  // Start with cwd
  let resolvedPath = globalThis.Deno?.cwd() || "/";

  // Process each path segment - absolute paths reset the resolved path
  for (const path of paths) {
    if (!path) continue;
    if (path.startsWith("/")) {
      // Absolute path resets
      resolvedPath = path;
    } else {
      // Relative path appends
      resolvedPath = resolvedPath + "/" + path;
    }
  }

  // Normalize the result
  const parts = resolvedPath.split("/").filter((p) => p.length > 0);
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      resolved.pop();
    } else if (part !== ".") {
      resolved.push(part);
    }
  }

  return `/${resolved.join("/")}`;
}

export function isAbsolute(path: string): boolean {
  if (!isDeno && hasNodePath) {
    return nodePath!.isAbsolute(path);
  }

  return path.startsWith("/");
}

export function relative(from: string, to: string): string {
  if (!isDeno && hasNodePath) {
    return nodePath!.relative(from, to);
  }

  const fromParts = resolve(from)
    .split("/")
    .filter((p: string) => p);
  const toParts = resolve(to)
    .split("/")
    .filter((p: string) => p);

  let common = 0;
  for (let i = 0; i < Math.min(fromParts.length, toParts.length); i++) {
    if (fromParts[i] !== toParts[i]) break;
    common++;
  }

  const ups = fromParts.length - common;
  const result = [...Array(ups).fill(".."), ...toParts.slice(common)];

  return result.join("/") || ".";
}

export function normalize(path: string): string {
  if (!isDeno && hasNodePath) {
    return nodePath!.normalize(path);
  }

  if (path === "") return ".";

  const isAbs = isAbsolute(path);
  const parts = path.split("/").filter((p) => p && p !== ".");

  const normalized: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      if (normalized.length > 0 && normalized[normalized.length - 1] !== "..") {
        normalized.pop();
      } else if (!isAbs) {
        normalized.push("..");
      }
    } else {
      normalized.push(part);
    }
  }

  const result = normalized.join("/");

  if (isAbs) {
    return result ? `/${result}` : "/";
  }

  return result || ".";
}
