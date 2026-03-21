import { basename, extname, normalize } from "veryfront/platform/path";
import type { KnowledgeIngestSkipReason } from "./result.ts";

const RICH_FILE_EXTENSIONS = new Set([
  ".pdf",
  ".csv",
  ".tsv",
  ".docx",
  ".xlsx",
  ".xls",
  ".pptx",
  ".html",
  ".htm",
  ".txt",
  ".json",
  ".md",
  ".mdx",
]);

const TEXT_FALLBACK_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".ini",
  ".java",
  ".js",
  ".jsonl",
  ".jsx",
  ".kt",
  ".less",
  ".lua",
  ".mjs",
  ".ndjson",
  ".php",
  ".pl",
  ".py",
  ".r",
  ".rb",
  ".rs",
  ".sass",
  ".scala",
  ".scss",
  ".sh",
  ".sql",
  ".swift",
  ".toml",
  ".tsx",
  ".ts",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);

const TEXT_FALLBACK_FILENAMES = new Set([
  "dockerfile",
  "makefile",
  "readme",
  "license",
  "changelog",
]);

const IGNORED_DIRECTORY_NAMES = new Set([
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

export type KnowledgeIngestSourceDecision =
  | { kind: "ingest" }
  | {
    kind: "skip";
    reason: KnowledgeIngestSkipReason;
    message: string;
  };

function normalizePathSegments(value: string): string[] {
  return normalize(value)
    .replaceAll("\\", "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function findHiddenSegment(segments: string[]): string | null {
  for (const segment of segments) {
    if (segment.startsWith(".")) {
      return segment;
    }
  }

  return null;
}

function findIgnoredDirectory(segments: string[]): string | null {
  for (const segment of segments) {
    if (IGNORED_DIRECTORY_NAMES.has(segment.toLowerCase())) {
      return segment;
    }
  }

  return null;
}

function isSupportedKnowledgeFile(path: string): boolean {
  const extension = extname(path).toLowerCase();
  if (
    extension && (RICH_FILE_EXTENSIONS.has(extension) || TEXT_FALLBACK_EXTENSIONS.has(extension))
  ) {
    return true;
  }

  const fileName = basename(path).toLowerCase();
  return TEXT_FALLBACK_FILENAMES.has(fileName);
}

function classifyCommonKnowledgePath(path: string): KnowledgeIngestSourceDecision | null {
  const segments = normalizePathSegments(path);
  const hiddenSegment = findHiddenSegment(segments);
  if (hiddenSegment != null) {
    return {
      kind: "skip",
      reason: "hidden_path",
      message: `Hidden file or directory skipped: ${hiddenSegment}`,
    };
  }

  const ignoredDirectory = findIgnoredDirectory(segments);
  if (ignoredDirectory != null) {
    return {
      kind: "skip",
      reason: "ignored_directory",
      message: `Ignored directory skipped: ${ignoredDirectory}`,
    };
  }

  return null;
}

export function classifyKnowledgeDirectoryPath(path: string): KnowledgeIngestSourceDecision {
  return classifyCommonKnowledgePath(path) ?? { kind: "ingest" };
}

export function classifyKnowledgeSourcePath(path: string): KnowledgeIngestSourceDecision {
  const commonDecision = classifyCommonKnowledgePath(path);
  if (commonDecision != null) {
    return commonDecision;
  }

  if (!isSupportedKnowledgeFile(path)) {
    const extension = extname(path).toLowerCase();
    return {
      kind: "skip",
      reason: "unsupported_file_type",
      message: `Unsupported file type: ${extension || basename(path)}`,
    };
  }

  return { kind: "ingest" };
}
