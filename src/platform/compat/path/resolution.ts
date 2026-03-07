import { isDeno, nodePath } from "./runtime.ts";

function hasWindowsLikePath(path: string): boolean {
  return path.includes("\\") || /^[A-Za-z]:/.test(path) || path.startsWith("\\\\");
}

/** Normalize backslashes to forward slashes (for Deno on Windows). */
function normSep(p: string): string {
  return p.includes("\\") ? p.replace(/\\/g, "/") : p;
}

/** Match Windows drive letter prefix like "C:/" */
const DRIVE_LETTER = /^[A-Za-z]:\//;

export function resolve(...paths: string[]): string {
  if (!isDeno && nodePath && !paths.some(hasWindowsLikePath)) return nodePath.resolve(...paths);

  let resolvedPath = normSep(globalThis.Deno?.cwd?.() ?? "/");

  for (const rawPath of paths) {
    if (!rawPath) continue;
    const path = normSep(rawPath);
    if (path.startsWith("/") || DRIVE_LETTER.test(path)) {
      resolvedPath = path;
    } else {
      resolvedPath = `${resolvedPath}/${path}`;
    }
  }

  // Preserve drive letter prefix (e.g. "D:/") if present
  let prefix = "/";
  const driveMatch = resolvedPath.match(DRIVE_LETTER);
  if (driveMatch) {
    prefix = driveMatch[0]; // e.g. "D:/"
    resolvedPath = resolvedPath.slice(prefix.length);
  } else if (resolvedPath.startsWith("/")) {
    resolvedPath = resolvedPath.slice(1);
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

  return `${prefix}${resolved.join("/")}`;
}

export function isAbsolute(path: string): boolean {
  if (!isDeno && nodePath && !hasWindowsLikePath(path) && nodePath.isAbsolute(path)) return true;
  // Cross-platform fallback: Unix, Windows drive letters, and UNC paths
  if (path.startsWith("/")) return true;
  if (/^[A-Za-z]:[/\\]/.test(path)) return true;
  return /^\\\\[^\\]+\\[^\\]+/.test(path);
}

export function relative(from: string, to: string): string {
  if (!isDeno && nodePath && !hasWindowsLikePath(from) && !hasWindowsLikePath(to)) {
    const relativePath = nodePath.relative(from, to);
    return relativePath || ".";
  }

  const resolvedFrom = resolve(from);
  const resolvedTo = resolve(to);

  // Strip drive prefix for comparison (both will share the same drive after resolve)
  const fromDrive = resolvedFrom.match(DRIVE_LETTER);
  const fromBase = fromDrive ? resolvedFrom.slice(fromDrive[0].length) : resolvedFrom.slice(1);
  const toDrive = resolvedTo.match(DRIVE_LETTER);
  const toBase = toDrive ? resolvedTo.slice(toDrive[0].length) : resolvedTo.slice(1);

  const fromParts = fromBase.split("/").filter(Boolean);
  const toParts = toBase.split("/").filter(Boolean);

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
  if (!isDeno && nodePath && !hasWindowsLikePath(path)) return nodePath.normalize(path);
  if (path === "") return ".";

  const p = normSep(path);
  const abs = isAbsolute(p);

  // Preserve drive letter prefix
  let prefix = "";
  const driveMatch = p.match(DRIVE_LETTER);
  if (driveMatch) {
    prefix = driveMatch[0];
  } else if (abs) {
    prefix = "/";
  }

  const pathWithoutPrefix = driveMatch ? p.slice(prefix.length) : abs ? p.slice(1) : p;
  const parts = pathWithoutPrefix.split("/").filter((s) => s && s !== ".");

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

  if (abs) return result ? `${prefix}${result}` : prefix || "/";

  return result || ".";
}
