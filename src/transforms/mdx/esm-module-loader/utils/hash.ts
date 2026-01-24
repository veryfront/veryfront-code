import { HASH_SEED_FNV1A } from "../constants.ts";

export function hashString(input: string): string {
  let hash = HASH_SEED_FNV1A >>> 0;

  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16);
}
