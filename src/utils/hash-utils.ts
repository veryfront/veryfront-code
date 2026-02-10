import { HASH_SEED_FNV1A } from "./constants/hash.ts";

export async function computeHash(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface BundleCode {
  code: string;
  css?: string;
  sourceMap?: string;
}

export function computeCodeHash(code: BundleCode): Promise<string> {
  return computeHash(`${code.code}${code.css ?? ""}${code.sourceMap ?? ""}`);
}

export function simpleHash(str: string): number {
  let hash = 0;

  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash &= hash;
  }

  return Math.abs(hash);
}

/** Hash string to hex (base 16) - used for module filenames */
export function hashCodeHex(str: string): string {
  return simpleHash(str).toString(16);
}

export async function shortHash(content: string): Promise<string> {
  const fullHash = await computeHash(content);
  return fullHash.slice(0, 8);
}

/** FNV-1a hash for strings - returns hex string */
export function fnv1aHash(input: string): string {
  let hash = HASH_SEED_FNV1A >>> 0;

  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16);
}
