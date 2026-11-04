import { createHash, Hash, hash as oneShotHash } from "node:crypto";
import { versions } from "node:process";

// Deno implements one-shot hashing through mutable public Hash methods.
// Node uses a native one-shot operation without the exposed Hash handle.
const nativeOneShotHash = versions.deno === undefined ? oneShotHash : undefined;
const apply = Reflect.apply;
const nativeCreateHash = createHash;
const update = Hash.prototype.update;
const digest = Hash.prototype.digest;

/** Hash host-owned recovery data without calling project-mutable prototype methods. */
export function privateSha256Hex(value: string | Uint8Array): string {
  if (nativeOneShotHash) return nativeOneShotHash("sha256", value, "hex");
  const hash = nativeCreateHash("sha256");
  apply(update, hash, [value, "utf8"]);
  return apply(digest, hash, ["hex"]);
}
