import type { DataResult } from "./types.ts";

export const redirect = (destination: string, permanent = false): DataResult => ({
  redirect: { destination, permanent },
});

export const notFound = (): DataResult => ({
  notFound: true,
});
