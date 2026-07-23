import { computeHash } from "../hash-utils.ts";

/** Compute integrity. */
export async function computeIntegrity(content: string): Promise<string> {
  const hash = await computeHash(content);
  return `sha256-${hash}`;
}

export async function verifyIntegrity(content: string, integrity: string): Promise<boolean> {
  const computed = await computeIntegrity(content);
  return computed === integrity;
}
