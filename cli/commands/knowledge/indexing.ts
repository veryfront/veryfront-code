import { createFileSystem } from "veryfront/platform";
import { inspectOkfDocument } from "veryfront/knowledge";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { chunkWithOffsets } from "#veryfront/embedding/chunk.ts";
import { embedding } from "#veryfront/embedding/embedding.ts";
import type { Embedding } from "#veryfront/embedding/types.ts";
import type { ApiClient } from "#cli/shared/config";
import type { PublishedFileReceipt } from "../files/command.ts";

export interface CanonicalKnowledgeIndexReceipt {
  file_id: string;
  version_id: string;
  path: string;
  checksum: string;
  indexed_chunk_count: number;
  model: { name: string; provider: string; dimension: number };
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

/** Index the exact published canonical version, never a synthetic RAG document. */
export async function indexKnowledgeDocument(
  input: IndexKnowledgeDocumentInput,
): Promise<CanonicalKnowledgeIndexReceipt> {
  const { published, signal } = input;
  signal?.throwIfAborted();
  if (!published.path.startsWith("knowledge/") || !/\.md$/i.test(published.path)) {
    throw new Error("Canonical indexing requires a knowledge Markdown file.");
  }
  if (
    !published.file_id || !UUID.test(published.file_id) ||
    !published.version_id || !UUID.test(published.version_id)
  ) {
    throw new Error(
      "Canonical publication did not return file_id and version_id; update the API before indexing knowledge.",
    );
  }
  const source = await createFileSystem().readTextFile(input.localPath);
  signal?.throwIfAborted();
  if (
    input.checksumAcknowledgement === "legacy-null" &&
    (!published.checksum || await computeHash(source) !== published.checksum)
  ) {
    throw new Error("Legacy canonical indexing requires the verified complete source checksum.");
  }
  const inspected = inspectOkfDocument(published.path, source);
  const body = inspected.body;
  const parts = (await chunkWithOffsets(body)).filter((part) => part.content.trim().length > 0);
  const texts = parts.map((part) => part.content);
  if (texts.length === 0) throw new Error("Knowledge document has no searchable text.");
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
        document_id: published.file_id,
        file_version_id: published.version_id,
        title: inspected.metadata.title ?? published.path,
        okf_metadata: inspected.metadata,
      },
      vector: vectors[chunk_index]!,
    };
  });
  const payload = { expected_version_id: published.version_id, chunks, model };
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
    ? published.checksum
    : undefined;
  if (
    result.file_id !== published.file_id || result.version_id !== published.version_id ||
    result.path !== published.path || typeof acknowledgedChecksum !== "string" ||
    !acknowledgedChecksum ||
    (published.checksum !== undefined && acknowledgedChecksum !== published.checksum) ||
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
