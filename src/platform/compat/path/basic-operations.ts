import { isDeno, nodePath } from "./runtime.ts";

export function join(...paths: string[]): string {
  if (!isDeno) {
    return nodePath!.join(...paths);
  }

  return (
    paths
      .filter((p) => p.length > 0)
      .join("/")
      .replace(/\/+/g, "/")
      .replace(/\/$/, "") || "/"
  );
}

export function dirname(path: string): string {
  if (!isDeno) {
    return nodePath!.dirname(path);
  }

  const lastSlash = path.lastIndexOf("/");
  if (lastSlash === -1) return ".";
  if (lastSlash === 0) return "/";
  return path.slice(0, lastSlash);
}

export function basename(path: string, ext?: string): string {
  if (!isDeno) {
    return nodePath!.basename(path, ext);
  }

  const lastSlash = path.lastIndexOf("/");
  let base = lastSlash === -1 ? path : path.slice(lastSlash + 1);

  if (ext && base.endsWith(ext)) {
    base = base.slice(0, -ext.length);
  }

  return base;
}

export function extname(path: string): string {
  if (!isDeno) {
    return nodePath!.extname(path);
  }

  const base = basename(path);
  const lastDot = base.lastIndexOf(".");
  if (lastDot === -1 || lastDot === 0) return "";
  return base.slice(lastDot);
}
