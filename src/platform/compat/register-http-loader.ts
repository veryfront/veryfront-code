import { isDeno, isNode } from "./runtime.ts";

let registered = false;
let httpLoaderAvailable = false;

export function registerHttpLoader(): boolean {
  if (registered) return httpLoaderAvailable;

  registered = true;

  if (isDeno) {
    httpLoaderAvailable = true;
    return true;
  }

  if (!isNode) return false;

  const nodeVersion = process.versions?.node;
  if (!nodeVersion) return httpLoaderAvailable;

  const major = Number(nodeVersion.split(".")[0]);
  if (major >= 20) httpLoaderAvailable = false;

  return httpLoaderAvailable;
}

export function isHttpLoaderAvailable(): boolean {
  return httpLoaderAvailable || isDeno;
}
