import { createFileSystem } from "veryfront/platform";
import { inspectOkfDocument } from "veryfront/knowledge";
import { computeHash } from "veryfront/utils";
import { chunkWithOffsets, type Embedding, embedding } from "veryfront/embedding";
import type { ApiClient } from "#cli/shared/config";
import type { PublishedFileReceipt } from "../files/command.ts";

export interface CanonicalKnowledgeIndexReceipt {
  file_id: string;
  version_id: string;
  path: string;
  checksum: string;
  indexed_chunk_count: number;
  model: { name: string; provider: string; dimension: number } | null;
}

export interface IndexKnowledgeDocumentInput {
  client: ApiClient;
  projectSlug: string;
  branch: string;
  published: PublishedFileReceipt;
  localPath: string;
  signal?: AbortSignal;
  embedder?: Embedding;
  /** Only the immutable existing-version path may accept a legacy null API checksum. */
  checksumAcknowledgement?: "legacy-null";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CHUNKS = 500;
const MAX_INDEX_BYTES = 10 * 1024 * 1024;

interface KnowledgeIndexStatusItem {
  path: string;
  file_id: string;
  file_version_id: string;
  index_ready: boolean;
}

interface KnowledgeIndexStatusResponse {
  data: KnowledgeIndexStatusItem[];
}

interface BranchListItem {
  id: string;
  name: string;
}

interface ListBranchesResponse {
  data: BranchListItem[];
  page_info?: { next?: string };
}

interface PublishedCanonicalVersion {
  path: string;
  file_id: string;
  version_id: string;
  checksum?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseKnowledgeIndexStatusResponse(value: unknown): KnowledgeIndexStatusResponse {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error("Knowledge index status response was invalid.");
  }
  const data: KnowledgeIndexStatusItem[] = [];
  for (const item of value.data) {
    if (!isRecord(item)) throw new Error("Knowledge index status response was invalid.");
    const { path, file_id, file_version_id, index_ready } = item;
    if (
      typeof path !== "string" || typeof file_id !== "string" ||
      typeof file_version_id !== "string" || typeof index_ready !== "boolean"
    ) {
      throw new Error("Knowledge index status response was invalid.");
    }
    data.push({ path, file_id, file_version_id, index_ready });
  }
  return { data };
}

function parseListBranchesResponse(value: unknown): ListBranchesResponse {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error("Branch lookup response was invalid.");
  }
  const data: BranchListItem[] = [];
  for (const item of value.data) {
    if (!isRecord(item)) throw new Error("Branch lookup response was invalid.");
    const { id, name } = item;
    if (typeof id !== "string" || typeof name !== "string") {
      throw new Error("Branch lookup response was invalid.");
    }
    data.push({ id, name });
  }
  const next = isRecord(value.page_info) && typeof value.page_info.next === "string"
    ? value.page_info.next
    : undefined;
  return { data, ...(next ? { page_info: { next } } : {}) };
}

async function resolveBranchIdByName(input: IndexKnowledgeDocumentInput): Promise<string> {
  let cursor: string | undefined;
  let match: BranchListItem | undefined;
  do {
    const response = parseListBranchesResponse(
      await input.client.get<unknown>(
        `/projects/${encodeURIComponent(input.projectSlug)}/branches`,
        {
          search: input.branch,
          limit: "100",
          ...(cursor ? { cursor } : {}),
        },
        input.signal ? { signal: input.signal, retryPolicy: "none" } : undefined,
      ),
    );
    input.signal?.throwIfAborted();
    const exact = response.data.filter((branch) => branch.name === input.branch);
    if (exact.length > 1 || (match && exact.length > 0)) {
      throw new Error(
        "Branch lookup returned multiple exact matches for empty canonical indexing.",
      );
    }
    match = exact[0] ?? match;
    cursor = response.page_info?.next;
  } while (cursor);
  if (!match) {
    throw new Error(
      "Branch lookup did not return the requested branch for empty canonical indexing.",
    );
  }
  if (!UUID.test(match.id)) {
    throw new Error("Branch lookup returned an invalid branch id for empty canonical indexing.");
  }
  return match.id;
}

async function buildPreviewBranchLookupTarget(input: IndexKnowledgeDocumentInput) {
  const branch = input.branch;
  if (branch === "main") return { kind: "preview_branch", branch_id: null };
  if (UUID.test(branch)) return { kind: "preview_branch", branch_id: branch };
  return { kind: "preview_branch", branch_id: await resolveBranchIdByName(input) };
}

function requirePublishedCanonicalVersion(
  published: PublishedFileReceipt,
): PublishedCanonicalVersion {
  if (
    !published.file_id || !UUID.test(published.file_id) ||
    !published.version_id || !UUID.test(published.version_id)
  ) {
    throw new Error(
      "Canonical publication did not return file_id and version_id; update the API before indexing knowledge.",
    );
  }
  return {
    path: published.path,
    file_id: published.file_id,
    version_id: published.version_id,
    ...(published.checksum ? { checksum: published.checksum } : {}),
  };
}

async function readEmptyCanonicalIndexReceipt(
  input: IndexKnowledgeDocumentInput,
  published: PublishedCanonicalVersion,
  source: string,
): Promise<CanonicalKnowledgeIndexReceipt> {
  const { signal } = input;
  const lookup_target = await buildPreviewBranchLookupTarget(input);
  const result = parseKnowledgeIndexStatusResponse(
    await input.client.post<unknown>(
      `/projects/${encodeURIComponent(input.projectSlug)}/knowledge/index-status`,
      {
        paths: [published.path],
        lookup_target,
      },
      signal ? { signal, retryPolicy: "none" } : undefined,
    ),
  );
  signal?.throwIfAborted();
  const current = result.data.find((item) => item.path === published.path);
  if (
    !current || current.file_id !== published.file_id ||
    current.file_version_id !== published.version_id || !current.index_ready
  ) {
    throw new Error(
      "Empty canonical index readiness does not match the published document version.",
    );
  }
  const checksum = await computeHash(source);
  if (published.checksum !== undefined && published.checksum !== checksum) {
    throw new Error(
      "Empty canonical index readiness requires the verified complete source checksum.",
    );
  }
  return {
    file_id: published.file_id,
    version_id: published.version_id,
    path: published.path,
    checksum: published.checksum ?? checksum,
    indexed_chunk_count: 0,
    model: null,
  };
}

/** Index the exact published canonical version, never a synthetic RAG document. */
export async function indexKnowledgeDocument(
  input: IndexKnowledgeDocumentInput,
): Promise<CanonicalKnowledgeIndexReceipt> {
  const { published, signal } = input;
  signal?.throwIfAborted();
  if (!published.path.startsWith("knowledge/") || !/\.md$/i.test(published.path)) {
    throw new Error("Canonical indexing requires a knowledge Markdown file.");
  }
  const canonicalVersion = requirePublishedCanonicalVersion(published);
  const source = await createFileSystem().readTextFile(input.localPath);
  signal?.throwIfAborted();
  if (
    input.checksumAcknowledgement === "legacy-null" &&
    (!canonicalVersion.checksum || await computeHash(source) !== canonicalVersion.checksum)
  ) {
    throw new Error("Legacy canonical indexing requires the verified complete source checksum.");
  }
  const inspected = inspectOkfDocument(canonicalVersion.path, source);
  const body = inspected.body;
  const parts = (await chunkWithOffsets(body)).filter((part) => part.content.trim().length > 0);
  const texts = parts.map((part) => part.content);
  if (texts.length === 0) {
    return readEmptyCanonicalIndexReceipt(input, canonicalVersion, source);
  }
  if (texts.length > MAX_CHUNKS) {
    throw new Error(
      `Knowledge document requires ${texts.length} chunks; the atomic index limit is ${MAX_CHUNKS}. Split the source into smaller documents and retry.`,
    );
  }
  signal?.throwIfAborted();
  const embedder = input.embedder ?? embedding({});
  const vectors = await embedder.embedMany(texts, { signal });
  signal?.throwIfAborted();
  const dimension = vectors[0]?.length ?? 0;
  if (
    ![768, 1024, 1536, 3072, 4096].includes(dimension) ||
    vectors.length !== texts.length ||
    vectors.some((vector) =>
      vector.length !== dimension || vector.some((value) => !Number.isFinite(value))
    )
  ) {
    throw new Error(
      "Embedding provider returned an invalid count, dimension, or non-finite vector.",
    );
  }
  const normalizedModel = embedder.model.startsWith("veryfront-cloud/")
    ? embedder.model.slice("veryfront-cloud/".length)
    : embedder.model;
  const separator = normalizedModel.indexOf("/");
  if (separator <= 0 || separator === normalizedModel.length - 1) {
    throw new Error("Embedding model must identify its provider and model name.");
  }
  const model = {
    provider: normalizedModel.slice(0, separator),
    name: normalizedModel.slice(separator + 1),
    dimension,
  };
  const bodyOffset = source.length - body.length;
  const chunks = parts.map(({ content, startOffset: start, endOffset: end }, chunk_index) => {
    if (body.slice(start, end) !== content) {
      throw new Error("Knowledge chunk does not match its canonical source position.");
    }
    return {
      chunk_index,
      content,
      start_offset: bodyOffset + start,
      end_offset: bodyOffset + end,
      token_count: Math.max(1, Math.ceil(content.length / 4)),
      metadata: {
        source: published.path,
        document_id: canonicalVersion.file_id,
        file_version_id: canonicalVersion.version_id,
        title: inspected.metadata.title ?? published.path,
        okf_metadata: inspected.metadata,
      },
      vector: vectors[chunk_index]!,
    };
  });
  const payload = { expected_version_id: canonicalVersion.version_id, chunks, model };
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_INDEX_BYTES) {
    throw new Error(
      "Knowledge index exceeds the 10 MiB atomic request limit. Split the source into smaller documents and retry.",
    );
  }
  signal?.throwIfAborted();
  const result = await input.client.post<
    Omit<CanonicalKnowledgeIndexReceipt, "checksum"> & { checksum: string | null }
  >(
    `/projects/${encodeURIComponent(input.projectSlug)}/branches/${
      encodeURIComponent(input.branch)
    }/files/${encodeURIComponent(published.path)}/index`,
    payload,
    signal ? { signal, retryPolicy: "none" } : undefined,
  );
  signal?.throwIfAborted();
  const acknowledgedChecksum = typeof result.checksum === "string" && result.checksum
    ? result.checksum
    : input.checksumAcknowledgement === "legacy-null" && result.checksum === null
    ? canonicalVersion.checksum
    : undefined;
  if (
    result.file_id !== canonicalVersion.file_id ||
    result.version_id !== canonicalVersion.version_id ||
    result.path !== published.path || typeof acknowledgedChecksum !== "string" ||
    !acknowledgedChecksum ||
    (canonicalVersion.checksum !== undefined &&
      acknowledgedChecksum !== canonicalVersion.checksum) ||
    result.indexed_chunk_count !== texts.length ||
    result.model?.name !== model.name || result.model?.provider !== model.provider ||
    result.model?.dimension !== dimension
  ) {
    throw new Error(
      "Canonical index acknowledgement does not match the published document version and model.",
    );
  }
  return { ...result, checksum: acknowledgedChecksum };
}
