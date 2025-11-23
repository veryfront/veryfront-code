import { isDeno } from "./runtime.ts";
import { isAbsolute, resolve } from "./resolution.ts";

export async function fromFileUrl(url: string | URL): Promise<string> {
  if (!isDeno) {
    const { fileURLToPath } = await import("node:url");
    return fileURLToPath(url);
  }

  const urlString = typeof url === "string" ? url : url.toString();
  if (!urlString.startsWith("file://")) {
    throw new TypeError("Must be a file URL");
  }

  return decodeURIComponent(urlString.slice(7));
}

export function toFileUrl(path: string): URL {
  if (!isDeno) {
    return new URL(`file://${path}`);
  }

  const absolute = isAbsolute(path) ? path : resolve(path);
  return new URL(`file://${absolute}`);
}
