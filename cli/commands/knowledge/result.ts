export type KnowledgeIngestSkipReason =
  | "hidden_path"
  | "ignored_directory"
  | "unsupported_file_type";

export type KnowledgeIngestFailureReason =
  | "parser_error"
  | "upload_error";

export interface KnowledgeIngestFileResult {
  source: string;
  localSourcePath: string;
  outputPath: string;
  remotePath: string;
  slug: string;
  sourceType: string;
  summary: string;
  stats: Record<string, unknown>;
  warnings: string[];
  documentKind?: "generated" | "okf_concept" | "okf_index" | "okf_log";
  okf?: {
    path: string;
    envelope_conforms: boolean;
    diagnostics: Array<{ code: string; message: string }>;
    metadata: Record<string, unknown>;
  };
}

export interface KnowledgeIngestSkippedFileResult {
  source: string;
  localSourcePath: string | null;
  reason: KnowledgeIngestSkipReason;
  message: string;
}

export interface KnowledgeIngestFailedFileResult {
  source: string;
  localSourcePath: string;
  reason: KnowledgeIngestFailureReason;
  message: string;
}

export interface KnowledgeIngestSummary {
  requested_count: number;
  ingested_count: number;
  skipped_count: number;
  failed_count: number;
}

export interface KnowledgeIngestResultMetadata {
  requested_count: number;
  source_mode: "explicit_sources" | "path_prefix";
  knowledge_path: string;
  okf_bundle: boolean;
  pending_acceptance: string[];
}

export interface KnowledgeIngestRunResult {
  kind: "knowledge_ingest";
  version: 1;
  metadata: KnowledgeIngestResultMetadata;
  summary: KnowledgeIngestSummary;
  ingested: KnowledgeIngestFileResult[];
  skipped: KnowledgeIngestSkippedFileResult[];
  failed: KnowledgeIngestFailedFileResult[];
}

export function buildKnowledgeIngestRunResult(input: {
  requestedCount: number;
  sourceMode: KnowledgeIngestResultMetadata["source_mode"];
  knowledgePath: string;
  okfBundle?: boolean;
  ingested: KnowledgeIngestFileResult[];
  skipped?: KnowledgeIngestSkippedFileResult[];
  failed?: KnowledgeIngestFailedFileResult[];
}): KnowledgeIngestRunResult {
  const skipped = input.skipped ?? [];
  const failed = input.failed ?? [];

  return {
    kind: "knowledge_ingest",
    version: 1,
    metadata: {
      requested_count: input.requestedCount,
      source_mode: input.sourceMode,
      knowledge_path: input.knowledgePath,
      okf_bundle: input.okfBundle ?? false,
      pending_acceptance: [
        "job_retry_idempotence",
        "derived_link_index",
        "provider_file_flow",
        "full_okf_import_export_roundtrip",
      ],
    },
    summary: {
      requested_count: input.requestedCount,
      ingested_count: input.ingested.length,
      skipped_count: skipped.length,
      failed_count: failed.length,
    },
    ingested: input.ingested,
    skipped,
    failed,
  };
}
