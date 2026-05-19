import type { DataResult } from "./types.ts";

/** Return a redirect result from a data loader. */
export function redirect(destination: string, permanent = false): DataResult {
  return { redirect: { destination, permanent } };
}

/** Return a 404 result from a data loader. */
export function notFound(): DataResult {
  return { notFound: true };
}
