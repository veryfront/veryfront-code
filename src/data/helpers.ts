import type { DataResult } from "./types.ts";

export function redirect(destination: string, permanent = false): DataResult {
  return { redirect: { destination, permanent } };
}

export function notFound(): DataResult {
  return { notFound: true };
}
