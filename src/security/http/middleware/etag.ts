import { HASH_SEED_DJB2 } from "#veryfront/utils/constants/hash.ts";

export function computeEtag(text: string): string {
  let hash = HASH_SEED_DJB2;

  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }

  return `W/"${(hash >>> 0).toString(16)}"`;
}
