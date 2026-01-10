import { HASH_SEED_DJB2 } from "@veryfront/utils/constants/hash.ts";

/** Compute weak ETag for content using DJB2 hash algorithm */
export function computeEtag(text: string): string {
  let h = HASH_SEED_DJB2;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h) ^ text.charCodeAt(i);
  }
  return `W/"${(h >>> 0).toString(16)}"`;
}
