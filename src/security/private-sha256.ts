import { createHash, Hash } from "node:crypto";

const apply = Reflect.apply;
const nativeCreateHash = createHash;
const update = Hash.prototype.update;
const digest = Hash.prototype.digest;

/** Hash host-owned recovery data without calling project-mutable prototype methods. */
export function privateSha256Hex(value: string): string {
  const hash = nativeCreateHash("sha256");
  apply(update, hash, [value, "utf8"]);
  return apply(digest, hash, ["hex"]);
}
