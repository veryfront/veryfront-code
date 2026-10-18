import { mapPrivateArray } from "#veryfront/security/private-array.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import { privateJsonStringify } from "#veryfront/security/private-json.ts";
import { privateSha256Hex } from "#veryfront/security/private-sha256.ts";
import { privateByteLength } from "#veryfront/security/private-bytes.ts";
import { testPrivateRegExp } from "#veryfront/security/private-regexp.ts";
import { Buffer } from "node:buffer";
import { defineSchema } from "#veryfront/schemas/index.ts";

const ceil = Math.ceil;
const isArray = Array.isArray;
const apply = Reflect.apply;
const sort = Array.prototype.sort;
const byteLength = Buffer.byteLength;
const bufferCompare = Buffer.compare;
const bufferFrom = Buffer.from;
const bufferToString = Buffer.prototype.toString;
const MAX_RELEASE_FILES = 10_000;
const MAX_RELEASE_BYTES = 64 * 1024 * 1024;
const getReleaseFileSchema = defineSchema((v) =>
  v.object({
    path: v.string().min(1).max(1_024),
    entityType: v.enum(["page", "component", "function", "virtual_file"]),
    content: v.string(),
  }).strict()
);
const getNativeReleaseFileSchema = defineSchema((v) =>
  v.union([
    v.object({
      kind: v.literal("text"),
      path: v.string().min(1).max(1_024),
      entityType: v.enum(["page", "component", "function", "virtual_file"]),
      content: v.string(),
    }).strict(),
    v.object({
      kind: v.literal("binary"),
      path: v.string().min(1).max(1_024),
      entityType: v.enum(["page", "component", "function", "virtual_file"]),
      contentBase64: v.string().max(4 * ceil(8 * 1024 * 1024 / 3)),
      contentHash: v.string().refine((value) => testPrivateRegExp(/^[a-f0-9]{64}$/, value)),
      byteSize: v.number().int().min(0).max(8 * 1024 * 1024),
    }).strict(),
  ])
);
const getAnyReleaseFileSchema = defineSchema((v) =>
  v.union([getReleaseFileSchema(), getNativeReleaseFileSchema()])
);
const hash = (value: string) => privateSha256Hex(value);

/**
 * Immutable release-source manifests: unchanged UTF-8 v1 and native mixed-byte v2.
 * This pure digest is data, never authority: only a captured trusted release provider
 * may supply the complete pinned listing when admitting a managed recovery run.
 * Existing source cache fingerprints intentionally use a different algorithm.
 */
export function createRecoverySourceManifest(value: unknown): {
  version: 1 | 2;
  hash: string;
  fileCount: number;
  totalBytes: number;
} {
  if (!isArray(value) || value.length > MAX_RELEASE_FILES) {
    throw new Error("Immutable recovery release listing exceeds its bound");
  }
  let native = false;
  let hasBinary = false;
  let totalBytes = 0;
  const parsed = mapPrivateArray(value, (entry) => {
    const file = getAnyReleaseFileSchema().parse(entry);
    if ("kind" in file) native = true;
    if ("kind" in file && file.kind === "binary") hasBinary = true;
    const size = "kind" in file && file.kind === "binary"
      ? file.byteSize
      : byteLength(file.content, "utf8");
    if (size > 8 * 1024 * 1024) throw new Error("Immutable recovery source file exceeds its bound");
    totalBytes += size;
    if (totalBytes > MAX_RELEASE_BYTES) {
      throw new Error("Immutable recovery release bytes exceed their bound");
    }
    return file;
  });
  if (native && !hasBinary) {
    throw new Error("Native version two requires binary source membership");
  }
  const paths = createPrivateSet<string>();
  const files = mapPrivateArray(parsed, (file) => {
    if (native && !("kind" in file)) {
      throw new Error("Native recovery source cannot mix legacy file entries");
    }
    if (paths.has(file.path)) throw new Error("Duplicate immutable recovery release path");
    if (byteLength(file.path, "utf8") > 1_024) {
      throw new Error("Immutable recovery release path exceeds its bound");
    }
    paths.add(file.path);
    let byteSize: number;
    let contentHash: string;
    if ("kind" in file && file.kind === "binary") {
      if (
        file.contentBase64.length !== 4 * ceil(file.byteSize / 3) ||
        !testPrivateRegExp(/^[A-Za-z0-9+/]*={0,2}$/, file.contentBase64)
      ) throw new Error("Invalid canonical recovery binary base64");
      const bytes = bufferFrom(file.contentBase64, "base64");
      const decodedSize = privateByteLength(bytes);
      if (
        decodedSize !== file.byteSize ||
        apply(bufferToString, bytes, ["base64"]) !== file.contentBase64 ||
        privateSha256Hex(bytes) !== file.contentHash
      ) throw new Error("Recovery binary source integrity failed");
      byteSize = decodedSize;
      contentHash = file.contentHash;
    } else {
      byteSize = byteLength(file.content, "utf8");
      contentHash = hash(file.content);
    }
    return native && "kind" in file
      ? { path: file.path, type: file.entityType, kind: file.kind, contentHash, byteSize }
      : { path: file.path, type: file.entityType, contentHash, byteSize };
  });
  apply(sort, files, [
    (first: typeof files[number], second: typeof files[number]) =>
      bufferCompare(bufferFrom(first.path, "utf8"), bufferFrom(second.path, "utf8")),
  ]);
  return {
    version: native ? 2 : 1,
    hash: hash(privateJsonStringify({ version: native ? 2 : 1, files })),
    fileCount: files.length,
    totalBytes,
  };
}
