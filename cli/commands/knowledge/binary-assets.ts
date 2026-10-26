import type { ApiClient } from "#cli/shared/config";
import { getBranchByName } from "../merge/command.ts";
import type { PublishedFileReceipt } from "../files/command.ts";

const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isCanonicalKnowledgePath(path: string): boolean {
  return path.length > 0 && path.length <= 1024 &&
    new TextEncoder().encode(path).length <= 1024 && path.split("/").length <= 64 &&
    path === path.normalize("NFC") && !/[\\<>:"|?*]/.test(path) &&
    ![...path].some((character) =>
      character.codePointAt(0)! < 32 || character.codePointAt(0)! === 127
    ) &&
    path.split("/").every((part) =>
      part.length > 0 && part !== "." && part !== ".." && !/[. ]$/.test(part) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
    );
}

export async function hashAssetBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readBinaryBytes(input: {
  client: ApiClient;
  path: string;
  byteSize: number;
  signal?: AbortSignal;
}): Promise<Uint8Array> {
  if (!input.client.getStream) {
    throw new Error("The API client does not support binary asset reads");
  }
  const stream = await input.client.getStream(input.path, {
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
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > input.byteSize) throw new Error("Binary bundle content exceeds its declared size");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
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
    !isCanonicalKnowledgePath(input.path) || /\.(?:md|mdx|tsx?|jsx?|json|ya?ml)$/i.test(input.path)
  ) {
    throw new Error("Binary assets require a canonical non-source companion path");
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
  async function reconcileAbsentAsset(branch: string): Promise<PublishedFileReceipt | undefined> {
    // Earlier bundle attempts can commit this exact companion before a later write fails.
    // Reconcile only the target file, without imposing bundle-wide limits on publication.
    let current: unknown;
    let absent = false;
    try {
      current = await input.client.get<unknown>(
        `/projects/${encodeURIComponent(input.project)}/files/${encodeURIComponent(input.path)}`,
        { ...(branch === "main" ? { ref: "main" } : { branch_id: branch }), exact_path: "true" },
        { signal: input.signal, retryPolicy: "none" },
      );
    } catch (error) {
      if (!error || typeof error !== "object" || !("status" in error) || error.status !== 404) {
        throw error;
      }
      absent = true;
    }
    input.signal?.throwIfAborted();
    if (absent) return undefined;
    if (
      !current || typeof current !== "object" || !("path" in current) ||
      current.path !== input.path ||
      !("id" in current) || typeof current.id !== "string" || !UUID.test(current.id) ||
      !("version_id" in current) || typeof current.version_id !== "string" ||
      !UUID.test(current.version_id) ||
      !("binary" in current) || !current.binary || typeof current.binary !== "object" ||
      !("byte_size" in current.binary) || current.binary.byte_size !== bytes.byteLength ||
      !("content_hash" in current.binary) || current.binary.content_hash !== hash ||
      !("content_type" in current.binary) || typeof current.binary.content_type !== "string"
    ) throw new Error("Binary asset path conflicts with the requested immutable companion (409)");
    const rawPath = `/projects/${encodeURIComponent(input.project)}/knowledge/assets/${
      encodeURIComponent(input.path)
    }?${new URLSearchParams({
      branch_id: branch,
      file_version_id: current.version_id,
      content_hash: hash,
    })}`;
    const remote = await readBinaryBytes({
      client: input.client,
      path: rawPath,
      byteSize: bytes.byteLength,
      signal: input.signal,
    });
    if (
      remote.byteLength !== bytes.byteLength || await hashAssetBytes(remote) !== hash ||
      !remote.every((byte, index) => byte === bytes[index])
    ) {
      throw new Error("Binary asset readback does not match its immutable bytes");
    }
    input.signal?.throwIfAborted();
    return {
      path: input.path,
      file_id: current.id,
      version_id: current.version_id,
      checksum: hash,
    };
  }
  if (input.expected.kind === "absent") {
    const reconciled = await reconcileAbsentAsset(branch);
    if (reconciled) return reconciled;
  }
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
    !isCanonicalKnowledgePath(root)
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
  function ownerSelector() {
    if (input.scope.kind === "release") return { type: "release", id: input.scope.releaseId };
    if (input.scope.branchId === "main") return { type: "main_branch", id: input.project };
    return { type: "preview_branch", id: input.scope.branchId };
  }
  const expectedSelector = ownerSelector();
  function validateManifestOwner(
    manifest: { files: unknown },
  ): asserts manifest is { files: unknown[]; total_bytes: number } {
    if (
      !("project_id" in manifest) || manifest.project_id !== input.project ||
      !("root_path" in manifest) || manifest.root_path !== root ||
      !("selector" in manifest) || !manifest.selector || typeof manifest.selector !== "object" ||
      !("type" in manifest.selector) || manifest.selector.type !== expectedSelector.type ||
      !("id" in manifest.selector) || manifest.selector.id !== expectedSelector.id ||
      !("file_count" in manifest) || manifest.file_count !== (manifest.files as unknown[]).length ||
      !("total_bytes" in manifest) || typeof manifest.total_bytes !== "number" ||
      !Number.isSafeInteger(manifest.total_bytes) || manifest.total_bytes < 0 ||
      manifest.total_bytes > 64 * 1024 * 1024
    ) {
      throw new Error("Knowledge bundle manifest does not match its requested owner");
    }
  }
  validateManifestOwner(manifest);
  const entries: { path: string; bytes: Uint8Array; fileId: string; versionId: string }[] = [];
  const paths = new Set<string>();
  let total = 0;
  const files: unknown[] = manifest.files;
  interface BundleEntry {
    path: string;
    file_id: string;
    file_version_id: string;
    byte_size: number;
    content_hash: string;
  }
  function isTextEntry(
    entry: BundleEntry,
  ): entry is BundleEntry & { kind: "text"; content: string } {
    return "kind" in entry && entry.kind === "text" && "content" in entry &&
      typeof entry.content === "string";
  }
  function isBinaryEntry(
    entry: BundleEntry,
  ): entry is BundleEntry & { kind: "binary"; content_path: string } {
    return "kind" in entry && entry.kind === "binary" && "content_path" in entry &&
      typeof entry.content_path === "string";
  }
  function validateEntry(entry: unknown): asserts entry is BundleEntry {
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
  }
  function boundBinaryUrl(entry: BundleEntry & { content_path: string }): URL {
    const expectedPath = `/projects/${encodeURIComponent(input.project)}/knowledge/assets/${
      encodeURIComponent(entry.path)
    }`;
    const url = new URL(entry.content_path, "https://bundle.invalid");
    const historical = url.searchParams.has("historical");
    if (
      (historical &&
        (scope.key !== "branch_id" || url.searchParams.get("historical") !== "true")) ||
      url.origin !== "https://bundle.invalid" || url.hash !== "" ||
      [...url.searchParams].length !== (historical ? 4 : 3) || url.pathname !== expectedPath ||
      url.searchParams.get(scope.key) !== scope.id ||
      url.searchParams.has(scope.key === "branch_id" ? "release_id" : "branch_id") ||
      url.searchParams.get("file_version_id") !== entry.file_version_id ||
      url.searchParams.get("content_hash") !== entry.content_hash || !input.client.getStream
    ) {
      throw new Error("Binary bundle entry is not bound to its owner and immutable version");
    }
    return url;
  }
  for (const entry of files) {
    input.signal?.throwIfAborted();
    validateEntry(entry);
    let bytes: Uint8Array;
    if (isTextEntry(entry)) {
      bytes = new TextEncoder().encode(entry.content);
    } else if (isBinaryEntry(entry)) {
      const url = boundBinaryUrl(entry);
      bytes = await readBinaryBytes({
        client: input.client,
        path: `${url.pathname}${url.search}`,
        byteSize: entry.byte_size,
        signal: input.signal,
      });
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
