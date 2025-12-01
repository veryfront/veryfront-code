export async function computeHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function getContentHash(content: string): Promise<string> {
  return computeHash(content);
}

export function computeContentHash(content: string): Promise<string> {
  return computeHash(content);
}

export interface BundleCode {
  code: string;
  css?: string;
  sourceMap?: string;
}

export function computeCodeHash(code: BundleCode): Promise<string> {
  const combined = code.code + (code.css || "") + (code.sourceMap || "");
  return computeHash(combined);
}

export function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export async function shortHash(content: string): Promise<string> {
  const fullHash = await computeHash(content);
  return fullHash.slice(0, 8);
}
