import { createHash } from "node:crypto";

/**
 * Return a collision-resistant, deterministic digest for executable-cache
 * identities and filenames.
 *
 * This loader is server-only and runs on Deno, Node, and Bun, all of which
 * provide the Node crypto compatibility API. A synchronous digest keeps the
 * existing filename/key builders synchronous without falling back to the
 * previous 32-bit FNV identity (which can alias unrelated executable code).
 */
export function hashString(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
