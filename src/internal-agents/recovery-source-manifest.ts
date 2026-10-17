import { privateJsonStringify } from "#veryfront/security/private-json.ts";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { defineSchema } from "#veryfront/schemas/index.ts";

const MAX_RELEASE_FILES = 10_000;
const MAX_RELEASE_BYTES = 64 * 1024 * 1024;
const getReleaseFileSchema = defineSchema((v) =>
  v.object({
    path: v.string().min(1).max(1_024),
    entityType: v.enum(["page", "component", "function", "virtual_file"]),
    content: v.string(),
  }).strict()
);
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/**
 * Explicit immutable-release-source manifest v1, shared with the API contract.
 * This pure digest is data, never authority: only a captured trusted release provider
 * may supply the complete pinned listing when admitting a managed recovery run.
 * Existing source cache fingerprints intentionally use a different algorithm.
 */
export function createRecoverySourceManifest(value: unknown): {
  version: 1;
  hash: string;
  fileCount: number;
  totalBytes: number;
} {
  if (!Array.isArray(value) || value.length > MAX_RELEASE_FILES) {
    throw new Error("Immutable recovery release listing exceeds its bound");
  }
  const paths = new Set<string>();
  let totalBytes = 0;
  const files = value.map((entry) => {
    const file = getReleaseFileSchema().parse(entry);
    if (paths.has(file.path)) throw new Error("Duplicate immutable recovery release path");
    if (Buffer.byteLength(file.path, "utf8") > 1_024) {
      throw new Error("Immutable recovery release path exceeds its bound");
    }
    paths.add(file.path);
    const byteSize = Buffer.byteLength(file.content, "utf8");
    if (byteSize > 8 * 1024 * 1024) {
      throw new Error("Immutable recovery source file exceeds its bound");
    }
    totalBytes += byteSize;
    if (totalBytes > MAX_RELEASE_BYTES) {
      throw new Error("Immutable recovery release bytes exceed their bound");
    }
    return { path: file.path, type: file.entityType, contentHash: hash(file.content), byteSize };
  });
  files.sort((first, second) =>
    Buffer.compare(Buffer.from(first.path, "utf8"), Buffer.from(second.path, "utf8"))
  );
  return {
    version: 1,
    hash: hash(privateJsonStringify({ version: 1, files })),
    fileCount: files.length,
    totalBytes,
  };
}
