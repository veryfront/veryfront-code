import { hasNodePath, isDeno, nodePath } from "./runtime.ts";

function useNodePath(): boolean {
  return !isDeno && hasNodePath;
}

export function resolve(...paths: string[]): string {
  if (useNodePath()) return nodePath!.resolve(...paths);

  let resolvedPath = globalThis.Deno?.cwd() ?? "/";

  for (const path of paths) {
    if (!path) continue;
    resolvedPath = path.startsWith("/") ? path : `${resolvedPath}/${path}`;
  }

  const parts = resolvedPath.split("/").filter(Boolean);
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === "..") {
      resolved.pop();
      continue;
    }
    if (part !== ".") resolved.push(part);
  }

  return `/${resolved.join("/")}`;
}

export function isAbsolute(path: string): boolean {
  if (useNodePath()) return nodePath!.isAbsolute(path);
  return path.startsWith("/");
}

export function relative(from: string, to: string): string {
  if (useNodePath()) return nodePath!.relative(from, to);

  const fromParts = resolve(from).split("/").filter(Boolean);
  const toParts = resolve(to).split("/").filter(Boolean);

  let common = 0;
  const minLen = Math.min(fromParts.length, toParts.length);

  for (let i = 0; i < minLen; i++) {
    if (fromParts[i] !== toParts[i]) break;
    common++;
  }

  const ups = fromParts.length - common;
  const result = [...new Array(ups).fill(".."), ...toParts.slice(common)];

  return result.join("/") || ".";
}

export function normalize(path: string): string {
  if (useNodePath()) return nodePath!.normalize(path);
  if (path === "") return ".";

  const abs = isAbsolute(path);
  const parts = path.split("/").filter((p) => p && p !== ".");

  const normalized: string[] = [];

  for (const part of parts) {
    if (part !== "..") {
      normalized.push(part);
      continue;
    }

    const last = normalized[normalized.length - 1];
    if (normalized.length > 0 && last !== "..") {
      normalized.pop();
      continue;
    }

    if (!abs) normalized.push("..");
  }

  const result = normalized.join("/");

  if (abs) return result ? `/${result}` : "/";

  return result || ".";
}
