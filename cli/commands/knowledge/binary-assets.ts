import type { ApiClient } from "#cli/shared/config";
import { getBranchByName } from "../merge/command.ts";
import type { PublishedFileReceipt } from "../files/command.ts";

const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isCanonicalKnowledgePath(path: string): boolean {
  return path.startsWith("knowledge/") &&
    path.split("/").every((part) =>
      part.length > 0 && part !== "." && part !== ".." &&
      ![...part].some((character) =>
        character === "\\" || character === ":" || character.charCodeAt(0) < 32
      )
    );
}

export async function hashAssetBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Publish one immutable companion version. An ambiguous write must be reconciled before retry. */
export async function putBinaryKnowledgeAsset(input: {
  client: ApiClient;
  project: string;
  path: string;
  localPath: string;
  branch: string;
  expected: { kind: "absent" } | { kind: "version"; versionId: string };
  signal?: AbortSignal;
}): Promise<PublishedFileReceipt> {
  if (!input.client.putBytes) throw new Error("The API client does not support binary assets");
  input.signal?.throwIfAborted();
  const branch = input.branch === "main" || UUID.test(input.branch)
    ? input.branch
    : (await getBranchByName(input.client, input.project, input.branch))?.id;
  if (!branch || (branch !== "main" && !UUID.test(branch))) {
    throw new Error("Binary assets require an existing branch UUID or name");
  }
  if (
    !isCanonicalKnowledgePath(input.path)
  ) {
    throw new Error("Binary assets require a canonical knowledge path");
  }
  if (input.expected.kind === "version" && !UUID.test(input.expected.versionId)) {
    throw new Error("Binary asset updates require an expected version UUID");
  }
  input.signal?.throwIfAborted();
  const stat = await Deno.stat(input.localPath);
  if (!stat.isFile || stat.size > MAX_ASSET_BYTES) {
    throw new Error("Binary asset exceeds the 8 MiB limit");
  }
  const bytes = await Deno.readFile(input.localPath);
  if (bytes.byteLength > MAX_ASSET_BYTES) throw new Error("Binary asset exceeds the 8 MiB limit");
  const hash = await hashAssetBytes(bytes);
  input.signal?.throwIfAborted();
  const path = `/projects/${encodeURIComponent(input.project)}/knowledge/assets/${
    encodeURIComponent(input.path)
  }?branch_id=${encodeURIComponent(branch)}`;
  const result = await input.client.putBytes<unknown>(path, bytes, {
    "X-VF-Content-SHA256": hash,
    ...(input.expected.kind === "absent"
      ? { "X-VF-Expected-Absent": "true" }
      : { "X-VF-Expected-Version-ID": input.expected.versionId }),
  }, { signal: input.signal, retryPolicy: "none" });
  input.signal?.throwIfAborted();
  if (
    !result || typeof result !== "object" || !("file_id" in result) ||
    typeof result.file_id !== "string" || !UUID.test(result.file_id) ||
    !("file_version_id" in result) || typeof result.file_version_id !== "string" ||
    !UUID.test(result.file_version_id) || !("path" in result) || result.path !== input.path ||
    !("byte_size" in result) || result.byte_size !== bytes.byteLength ||
    !("content_hash" in result) || result.content_hash !== hash || !("content_type" in result) ||
    typeof result.content_type !== "string"
  ) {
    throw new Error("Binary asset publication returned an invalid identity receipt");
  }
  return {
    path: result.path,
    file_id: result.file_id,
    version_id: result.file_version_id,
    checksum: result.content_hash,
  };
}

/** Resolve a native bundle to verified raw bytes without rewriting text or relative links. */
export async function readKnowledgeBundle(input: {
  client: ApiClient;
  project: string;
  rootPath: string;
  scope: { kind: "branch"; branchId: string } | { kind: "release"; releaseId: string };
  signal?: AbortSignal;
}): Promise<{ path: string; bytes: Uint8Array; fileId: string; versionId: string }[]> {
  if (!UUID.test(input.project)) {
    throw new Error("Bundle export requires the resolved project UUID");
  }
  const scope = input.scope.kind === "branch"
    ? { key: "branch_id", id: input.scope.branchId }
    : { key: "release_id", id: input.scope.releaseId };
  if (!UUID.test(scope.id) && !(scope.key === "branch_id" && scope.id === "main")) {
    throw new Error("Bundle export requires an explicit owner");
  }
  const root = input.rootPath;
  if (
    root !== "knowledge" && !isCanonicalKnowledgePath(root)
  ) {
    throw new Error("Bundle export requires a canonical knowledge root");
  }
  const manifest = await input.client.get<unknown>(
    `/projects/${encodeURIComponent(input.project)}/knowledge/bundles/export`,
    { root_path: root, [scope.key]: scope.id },
    { signal: input.signal, retryPolicy: "none" },
  );
  if (
    !manifest || typeof manifest !== "object" || !("files" in manifest) ||
    !Array.isArray(manifest.files) || manifest.files.length > 1000
  ) {
    throw new Error("Invalid knowledge bundle manifest");
  }
  const expectedSelector = input.scope.kind === "release"
    ? { type: "release", id: input.scope.releaseId }
    : input.scope.branchId === "main"
    ? { type: "main_branch", id: input.project }
    : { type: "preview_branch", id: input.scope.branchId };
  if (
    !("selector" in manifest) || !manifest.selector || typeof manifest.selector !== "object" ||
    !("type" in manifest.selector) || manifest.selector.type !== expectedSelector.type ||
    !("id" in manifest.selector) || manifest.selector.id !== expectedSelector.id ||
    !("file_count" in manifest) || manifest.file_count !== manifest.files.length ||
    !("total_bytes" in manifest) || typeof manifest.total_bytes !== "number" ||
    !Number.isSafeInteger(manifest.total_bytes) || manifest.total_bytes < 0 ||
    manifest.total_bytes > 64 * 1024 * 1024
  ) {
    throw new Error("Knowledge bundle manifest does not match its requested owner");
  }
  const entries: { path: string; bytes: Uint8Array; fileId: string; versionId: string }[] = [];
  const paths = new Set<string>();
  let total = 0;
  const files: unknown[] = manifest.files;
  for (const entry of files) {
    input.signal?.throwIfAborted();
    if (
      !entry || typeof entry !== "object" || !("path" in entry) || typeof entry.path !== "string" ||
      !entry.path.startsWith(`${root}/`) || !isCanonicalKnowledgePath(entry.path) ||
      !("file_id" in entry) || typeof entry.file_id !== "string" ||
      !UUID.test(entry.file_id) || !("file_version_id" in entry) ||
      typeof entry.file_version_id !== "string" || !UUID.test(entry.file_version_id) ||
      !("byte_size" in entry) || typeof entry.byte_size !== "number" ||
      !Number.isSafeInteger(entry.byte_size) || entry.byte_size < 0 ||
      entry.byte_size > MAX_ASSET_BYTES || !("content_hash" in entry) ||
      typeof entry.content_hash !== "string" || !/^[0-9a-f]{64}$/.test(entry.content_hash)
    ) {
      throw new Error("Invalid knowledge bundle entry");
    }
    const collision = entry.path.toLowerCase();
    if (paths.has(collision)) {
      throw new Error("Duplicate knowledge bundle path");
    }
    paths.add(collision);
    total += entry.byte_size;
    if (total > 64 * 1024 * 1024) {
      throw new Error("Knowledge bundle exceeds the 64 MiB limit");
    }
    let bytes: Uint8Array;
    if (
      "kind" in entry && entry.kind === "text" && "content" in entry &&
      typeof entry.content === "string"
    ) {
      bytes = new TextEncoder().encode(entry.content);
    } else if (
      "kind" in entry && entry.kind === "binary" && "content_path" in entry &&
      typeof entry.content_path === "string"
    ) {
      const expectedPath = `/projects/${encodeURIComponent(input.project)}/knowledge/assets/${
        encodeURIComponent(entry.path)
      }`;
      const url = new URL(entry.content_path, "https://bundle.invalid");
      if (
        url.origin !== "https://bundle.invalid" || url.hash !== "" ||
        [...url.searchParams].length !== 3 || url.pathname !== expectedPath ||
        url.searchParams.get(scope.key) !== scope.id ||
        url.searchParams.has(scope.key === "branch_id" ? "release_id" : "branch_id") ||
        url.searchParams.get("file_version_id") !== entry.file_version_id ||
        url.searchParams.get("content_hash") !== entry.content_hash || !input.client.getStream
      ) {
        throw new Error("Binary bundle entry is not bound to its owner and immutable version");
      }
      const stream = await input.client.getStream(`${url.pathname}${url.search}`, {
        signal: input.signal,
        retryPolicy: "none",
      });
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          input.signal?.throwIfAborted();
          const chunk = await reader.read();
          if (chunk.done) {
            break;
          }
          size += chunk.value.byteLength;
          if (size > entry.byte_size) {
            throw new Error("Binary bundle content exceeds its declared size");
          }
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
    } else {
      throw new Error("Unsupported knowledge bundle entry kind");
    }
    if (
      bytes.byteLength !== entry.byte_size || await hashAssetBytes(bytes) !== entry.content_hash
    ) {
      throw new Error("Knowledge bundle content does not match its immutable digest");
    }
    entries.push({
      path: entry.path,
      bytes,
      fileId: entry.file_id,
      versionId: entry.file_version_id,
    });
  }
  if (total !== manifest.total_bytes) {
    throw new Error("Knowledge bundle total does not match its manifest");
  }
  return entries;
}
