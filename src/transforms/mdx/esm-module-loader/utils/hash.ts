import { HASH_SEED_FNV1A } from "../constants.ts";

export function hashString(input: string): string {
  let hash = HASH_SEED_FNV1A >>> 0;

  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16);
}
