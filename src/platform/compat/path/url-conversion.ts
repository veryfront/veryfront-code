import { fileURLToPath, pathToFileURL } from "node:url";

export function fromFileUrl(url: string | URL): string {
  return fileURLToPath(url);
}

export function toFileUrl(path: string): URL {
  return pathToFileURL(path);
}
