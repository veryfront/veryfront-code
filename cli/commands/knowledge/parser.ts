import { basename, dirname, extname, join } from "veryfront/platform/path";
import { importFirstPartyExtensionModule } from "veryfront/extensions/first-party-import";
import type {
  DocumentExtractionOptions,
  DocumentExtractionProgress,
  DocumentExtractionProgressEvent,
} from "veryfront/extensions/compat";
import { inspectOkfDocument, type OkfDocumentDiagnostic } from "veryfront/knowledge";
import { VERSION } from "#cli/utils";

export interface KnowledgeParserResult {
  success: true;
  source_path: string;
  source_filename: string;
  source_type: string;
  slug: string;
  sandbox_output_path: string;
  suggested_project_path: string;
  description: string;
  title: string;
  summary: string;
  stats: Record<string, unknown>;
  warnings: string[];
  document_kind?: "generated" | "okf_concept" | "okf_index" | "okf_log";
  okf?: {
    path: string;
    envelope_conforms: boolean;
    diagnostics: OkfDocumentDiagnostic[];
    metadata: Record<string, unknown>;
  };
}

export interface KnowledgeParserInput {
  filePath: string;
  description?: string;
  slug?: string;
  sourceReference?: string;
  okfRelativePath?: string;
  okfRole?: "companion";
}

export type ExtractDocumentText = (
  input: {
    filePath: string;
    mimeType: string;
    onProgress?: DocumentExtractionProgress;
    signal?: AbortSignal;
  },
) => Promise<string>;

type DocumentKreuzbergExtensionModule = {
  KreuzbergDocumentExtractor: new () => {
    extractInWorker(
      buffer: ArrayBuffer,
      mimeType: string,
      options?: DocumentExtractionOptions,
    ): Promise<string>;
  };
};

export interface RunKnowledgeParsersDeps {
  signal?: AbortSignal;
  extractDocumentText?: ExtractDocumentText;
  onProgress?: (event: DocumentExtractionProgressEvent) => void | Promise<void>;
}

interface ResolvedRunKnowledgeParsersDeps {
  signal?: AbortSignal;
  extractDocumentText: ExtractDocumentText;
  onProgress?: (event: DocumentExtractionProgressEvent) => void | Promise<void>;
}

const CODE_FENCE = "`".repeat(3);

const TEXT_FILE_EXTENSIONS = new Set([
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
  ".ts",
  ".tsx",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);

const TEXT_FILE_NAMES = new Set([
  "dockerfile",
  "makefile",
  "readme",
  "license",
  "changelog",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".epub": "application/epub+zip",
  ".htm": "text/html",
  ".html": "text/html",
  ".json": "application/json",
  ".md": "text/markdown",
  ".mdx": "text/mdx",
  ".pdf": "application/pdf",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".rtf": "application/rtf",
  ".tsv": "text/tab-separated-values",
  ".txt": "text/plain",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xml": "text/xml",
};

type ParserOutput = {
  content: string;
  stats: Record<string, unknown>;
  warnings: string[];
};

type ParserDefinition = {
  sourceType: string;
  parse: (path: string, deps: ResolvedRunKnowledgeParsersDeps) => Promise<ParserOutput>;
};

export function slugifyKnowledgeValue(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
    "document";
}

function titleizeFilename(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const title = stem.replaceAll("_", " ").replaceAll("-", " ").trim();
  return title
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ") || name;
}

function cleanText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function yamlQuote(value: unknown): string {
  return JSON.stringify(value == null ? "" : String(value));
}

function isAbsoluteProvenanceUrl(source: string): boolean {
  try {
    const url = new URL(source);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function buildFrontmatter(source: string, sourceType: string, description: string): string {
  const lines = [
    "---",
    `type: ${yamlQuote("Generated Document")}`,
    `source: ${yamlQuote(source)}`,
    `source_type: ${yamlQuote(sourceType)}`,
    `description: ${yamlQuote(description)}`,
    "generated:",
    `  by: ${yamlQuote(`veryfront/${VERSION}`)}`,
  ];
  if (isAbsoluteProvenanceUrl(source)) {
    lines.push(
      "sources:",
      "  - id: source",
      `    resource: ${yamlQuote(source)}`,
    );
  }
  lines.push("---");
  return lines.join("\n");
}

function validateOkfBundleRelativePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").split("/").filter((segment) => segment.length > 0)
    .join("/");
  if (
    !normalized || normalized.startsWith("/") || normalized.startsWith("../") ||
    normalized === ".." || normalized.split("/").includes("..")
  ) {
    throw new Error(`Invalid OKF bundle path: ${path}`);
  }
  return normalized;
}

function validateOkfDocumentRelativePath(path: string): string {
  const normalized = validateOkfBundleRelativePath(path);
  if (!normalized.toLowerCase().endsWith(".md")) {
    throw new Error(`OKF bundle mode only inspects Markdown documents: ${path}`);
  }
  return normalized;
}

function validateOkfCompanionRelativePath(path: string): string {
  return validateOkfBundleRelativePath(path);
}

function decodeOkfUtf8(relativePath: string, bytes: Uint8Array): string {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error(
      `OKF bundle file is not valid UTF-8 and cannot be uploaded through text knowledge storage: ${relativePath}`,
    );
  }

  const reencoded = new TextEncoder().encode(decoded);
  if (reencoded.byteLength !== bytes.byteLength) {
    throw new Error(
      `OKF bundle file is not stable UTF-8 text and cannot be uploaded through text knowledge storage: ${relativePath}`,
    );
  }
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (bytes[index] !== reencoded[index]) {
      throw new Error(
        `OKF bundle file is not stable UTF-8 text and cannot be uploaded through text knowledge storage: ${relativePath}`,
      );
    }
  }
  return decoded;
}

function okfDocumentKind(kind: "concept" | "index" | "log"):
  | "okf_concept"
  | "okf_index"
  | "okf_log" {
  if (kind === "index") return "okf_index";
  if (kind === "log") return "okf_log";
  return "okf_concept";
}

function okfDocumentSummary(kind: "concept" | "index" | "log"): string {
  if (kind === "index") return "Preserved OKF reserved index document.";
  if (kind === "log") return "Preserved OKF reserved log document.";
  return "Preserved OKF concept document.";
}

async function preserveOkfCompanion(input: {
  filePath: string;
  outputDir: string;
  relativePath: string;
  signal?: AbortSignal;
  sourceReference?: string;
}): Promise<KnowledgeParserResult> {
  const relativePath = validateOkfCompanionRelativePath(input.relativePath);
  input.signal?.throwIfAborted();
  const bytes = await Deno.readFile(input.filePath);
  input.signal?.throwIfAborted();
  const source = decodeOkfUtf8(relativePath, bytes);
  if (relativePath.toLowerCase().endsWith(".md")) {
    const inspected = inspectOkfDocument(relativePath, source);
    // A reference does not demote canonical documents. Unknown explicit types
    // remain OKF types. Otherwise the explicit artifact role preserves its bytes,
    // even when its contents resemble malformed YAML frontmatter.
    if (
      inspected.kind !== "concept" || "type" in inspected.metadata ||
      "okf_version" in inspected.metadata
    ) return await preserveOkfDocument(input);
  }
  const outputPath = join(input.outputDir, ...relativePath.split("/"));
  await Deno.mkdir(dirname(outputPath), { recursive: true });
  input.signal?.throwIfAborted();
  await Deno.writeFile(outputPath, bytes, { signal: input.signal });
  return {
    success: true,
    source_path: input.filePath,
    source_filename: basename(input.filePath),
    source_type: "okf_companion",
    slug: slugifyKnowledgeValue(relativePath.replace(/\.[^.]+$/i, "")),
    sandbox_output_path: outputPath,
    suggested_project_path: `knowledge/${relativePath}`,
    description: "OKF companion asset",
    title: titleizeFilename(relativePath),
    summary: "Preserved referenced OKF companion asset.",
    stats: { bytes: bytes.byteLength },
    warnings: [],
  };
}

async function preserveOkfDocument(input: {
  filePath: string;
  outputDir: string;
  relativePath: string;
  sourceReference?: string;
  signal?: AbortSignal;
}): Promise<KnowledgeParserResult> {
  const relativePath = validateOkfDocumentRelativePath(input.relativePath);
  input.signal?.throwIfAborted();
  const source = decodeOkfUtf8(relativePath, await Deno.readFile(input.filePath));
  input.signal?.throwIfAborted();
  const inspected = inspectOkfDocument(relativePath, source);
  if (!inspected.envelopeConforms) {
    const details = inspected.diagnostics.map((diagnostic) => diagnostic.message).join(" ");
    throw new Error(`OKF document failed diagnostics for ${relativePath}: ${details}`);
  }
  const outputPath = join(input.outputDir, ...relativePath.split("/"));
  await Deno.mkdir(dirname(outputPath), { recursive: true });
  input.signal?.throwIfAborted();
  await Deno.writeTextFile(outputPath, source, { signal: input.signal });
  const title = typeof inspected.metadata.title === "string" && inspected.metadata.title.trim()
    ? inspected.metadata.title
    : titleizeFilename(relativePath);
  return {
    success: true,
    source_path: input.filePath,
    source_filename: basename(input.filePath),
    source_type: "okf_markdown",
    slug: slugifyKnowledgeValue(relativePath.replace(/\.md$/i, "")),
    sandbox_output_path: outputPath,
    suggested_project_path: `knowledge/${relativePath}`,
    description: inspected.kind === "concept"
      ? "OKF concept document"
      : `OKF ${inspected.kind} document`,
    title,
    summary: okfDocumentSummary(inspected.kind),
    stats: {
      characters: source.length,
      metadata_keys: Object.keys(inspected.metadata).length,
      okf_kind: inspected.kind,
    },
    warnings: [],
    document_kind: okfDocumentKind(inspected.kind),
    okf: {
      path: relativePath,
      envelope_conforms: inspected.envelopeConforms,
      diagnostics: inspected.diagnostics,
      metadata: inspected.metadata,
    },
  };
}

function tableToMarkdown(rows: string[][]): string {
  if (!rows.length) return "";

  const maxColumns = Math.max(...rows.map((row) => row.length));
  if (maxColumns === 0) return "";

  const normalized = rows.map((row) =>
    Array.from(
      { length: maxColumns },
      (_, index) => (row[index] ?? "").replaceAll("|", "\\|").replaceAll("\n", " ").trim(),
    )
  );
  const [header = [], ...body] = normalized;
  return [
    `| ${header.join(" | ")} |`,
    `| ${Array.from({ length: maxColumns }, () => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

async function parseCsvLike(path: string, delimiter: "," | "\t"): Promise<ParserOutput> {
  const raw = await Deno.readTextFile(path);
  const lines = raw.split("\n").filter((line) => line.trim());
  if (!lines.length) {
    return { content: "_Empty file._", stats: { rows: 0, columns: 0 }, warnings: [] };
  }

  const parseLine = delimiter === ","
    ? parseCsvLine
    : (line: string) => line.split("\t").map((value) => value.trim());
  const header = parseLine(lines[0] ?? "");
  const data = lines.slice(1).map(parseLine);
  const limitedRows = [header, ...data.slice(0, 200)];
  const warnings = data.length > 200
    ? [`Truncated ${data.length - 200} rows from markdown output`]
    : [];

  const parts = [
    `**Rows:** ${data.length} | **Columns:** ${header.length}`,
    "",
    tableToMarkdown(limitedRows),
  ];
  if (data.length > 200) {
    parts.push(`\n_...and ${data.length - 200} more rows (truncated)._`);
  }

  return {
    content: parts.join("\n").trim(),
    stats: { rows: data.length, columns: header.length },
    warnings,
  };
}

async function parseText(path: string): Promise<ParserOutput> {
  const content = cleanText(await Deno.readTextFile(path));
  return {
    content,
    stats: { characters: content.length, lines: content ? content.split("\n").length : 0 },
    warnings: [],
  };
}

async function parseJson(path: string): Promise<ParserOutput> {
  const raw = await Deno.readTextFile(path);
  const data = JSON.parse(raw) as unknown;

  if (
    Array.isArray(data) && data.length > 0 && data[0] != null && typeof data[0] === "object" &&
    !Array.isArray(data[0])
  ) {
    const first = data[0] as Record<string, unknown>;
    const headers = Object.keys(first);
    const rows = data.slice(0, 200).map((entry) => {
      const record = entry != null && typeof entry === "object" && !Array.isArray(entry)
        ? entry as Record<string, unknown>
        : {};
      return headers.map((header) => String(record[header] ?? ""));
    });
    const warnings = data.length > 200
      ? [`Truncated ${data.length - 200} records from markdown output`]
      : [];
    const parts = [
      `**Records:** ${data.length} | **Fields:** ${headers.length}`,
      "",
      tableToMarkdown([headers, ...rows]),
    ];
    if (data.length > 200) {
      parts.push(`\n_...and ${data.length - 200} more records (truncated)._`);
    }
    return {
      content: parts.join("\n").trim(),
      stats: { records: data.length, fields: headers.length },
      warnings,
    };
  }

  const rendered = JSON.stringify(data, null, 2);
  return {
    content: `${CODE_FENCE}json\n${rendered}\n${CODE_FENCE}`,
    stats: { top_level_type: Array.isArray(data) ? "list" : typeof data },
    warnings: [],
  };
}

async function parseWithKreuzberg(
  path: string,
  deps: ResolvedRunKnowledgeParsersDeps,
): Promise<ParserOutput> {
  const mimeType = MIME_BY_EXTENSION[extname(path).toLowerCase()] ?? "application/octet-stream";
  const content = cleanText(
    await deps.extractDocumentText({
      filePath: path,
      mimeType,
      onProgress: deps.onProgress,
      signal: deps.signal,
    }),
  );
  return {
    content: content || "_No extractable text found in document._",
    stats: {
      characters: content.length,
      lines: content ? content.split("\n").length : 0,
      engine: "kreuzberg",
    },
    warnings: [],
  };
}

function selectParserDefinition(path: string): ParserDefinition {
  const extension = extname(path).toLowerCase();
  const name = basename(path).toLowerCase();

  if (extension === ".csv" || extension === ".tsv") {
    const delimiter = extension === ".tsv" ? "\t" : ",";
    return {
      sourceType: extension.slice(1),
      parse: (filePath) => parseCsvLike(filePath, delimiter),
    };
  }

  if (extension === ".txt" || extension === ".md" || extension === ".mdx") {
    return { sourceType: extension.slice(1), parse: parseText };
  }

  if (extension === ".json") {
    return { sourceType: "json", parse: parseJson };
  }

  if (TEXT_FILE_EXTENSIONS.has(extension)) {
    return { sourceType: extension.slice(1), parse: parseText };
  }

  if (!extension && TEXT_FILE_NAMES.has(name)) {
    return { sourceType: "text", parse: parseText };
  }

  if (extension in MIME_BY_EXTENSION) {
    return {
      sourceType: extension.slice(1),
      parse: (filePath, deps) => parseWithKreuzberg(filePath, deps),
    };
  }

  throw new Error(`Unsupported file type: ${extension || name}`);
}

function buildSummary(sourceType: string, stats: Record<string, unknown>): string {
  if (stats.engine === "kreuzberg") {
    return `Extracted ${sourceType.toUpperCase()} text with Kreuzberg (${
      stats.characters ?? 0
    } chars).`;
  }
  if (sourceType === "csv" || sourceType === "tsv") {
    return `Parsed ${stats.rows ?? 0} rows across ${stats.columns ?? 0} columns.`;
  }
  if (sourceType === "json") {
    if ("records" in stats) {
      return `Parsed ${stats.records ?? 0} record(s) across ${stats.fields ?? 0} fields.`;
    }
    return `Converted JSON (${stats.top_level_type ?? "object"}) to markdown.`;
  }
  return `Converted document to markdown (${stats.characters ?? 0} chars).`;
}

async function defaultExtractDocumentText(
  input: {
    filePath: string;
    mimeType: string;
    onProgress?: DocumentExtractionProgress;
    signal?: AbortSignal;
  },
): Promise<string> {
  input.signal?.throwIfAborted();
  const bytes = await Deno.readFile(input.filePath);
  input.signal?.throwIfAborted();
  const { KreuzbergDocumentExtractor } = await importFirstPartyExtensionModule<
    DocumentKreuzbergExtensionModule
  >(
    "ext-document-kreuzberg",
    "@veryfront/ext-document-kreuzberg",
  );
  input.signal?.throwIfAborted();
  const extractor = new KreuzbergDocumentExtractor();
  return await extractor.extractInWorker(
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ),
    input.mimeType,
    { onProgress: input.onProgress, signal: input.signal },
  );
}

export async function runKnowledgeParser(input: {
  filePath: string;
  outputDir: string;
  description?: string;
  slug?: string;
  sourceReference?: string;
  okfRelativePath?: string;
  okfRole?: "companion";
}, deps: RunKnowledgeParsersDeps = {}): Promise<KnowledgeParserResult> {
  const [result] = await runKnowledgeParsers({
    files: [{
      filePath: input.filePath,
      description: input.description,
      slug: input.slug,
      sourceReference: input.sourceReference,
      okfRelativePath: input.okfRelativePath,
      okfRole: input.okfRole,
    }],
    outputDir: input.outputDir,
  }, deps);

  if (!result) {
    throw new Error("knowledge ingest parser returned no results");
  }

  return result;
}

export async function runKnowledgeParsers(input: {
  files: KnowledgeParserInput[];
  outputDir: string;
}, deps: RunKnowledgeParsersDeps = {}): Promise<KnowledgeParserResult[]> {
  deps.signal?.throwIfAborted();
  if (!input.files.length) {
    return [];
  }

  const parserDeps: ResolvedRunKnowledgeParsersDeps = {
    extractDocumentText: deps.extractDocumentText ?? defaultExtractDocumentText,
    onProgress: deps.onProgress,
    signal: deps.signal,
  };

  deps.signal?.throwIfAborted();
  await Deno.mkdir(input.outputDir, { recursive: true });
  const results: KnowledgeParserResult[] = [];

  for (const file of input.files) {
    try {
      deps.signal?.throwIfAborted();
      const stat = await Deno.stat(file.filePath);
      if (!stat.isFile) {
        throw new Error(`File not found: ${file.filePath}`);
      }

      deps.signal?.throwIfAborted();
      if (file.okfRelativePath !== undefined) {
        const preserve =
          file.okfRelativePath.toLowerCase().endsWith(".md") && file.okfRole !== "companion"
            ? preserveOkfDocument({
              filePath: file.filePath,
              outputDir: input.outputDir,
              relativePath: file.okfRelativePath,
              signal: deps.signal,
              sourceReference: file.sourceReference,
            })
            : preserveOkfCompanion({
              filePath: file.filePath,
              outputDir: input.outputDir,
              relativePath: file.okfRelativePath,
              signal: deps.signal,
              sourceReference: file.sourceReference,
            });
        results.push(await preserve);
        continue;
      }

      const definition = selectParserDefinition(file.filePath);
      const parsed = await definition.parse(file.filePath, parserDeps);
      deps.signal?.throwIfAborted();
      const content = cleanText(parsed.content);
      const fileName = basename(file.filePath);
      const extension = extname(fileName);
      const stem = extension ? fileName.slice(0, -extension.length) : fileName;
      const slug = file.slug ?? slugifyKnowledgeValue(stem);
      const description = file.description ?? `Parsed from ${basename(file.filePath)}`;
      const title = titleizeFilename(file.filePath);
      const outputPath = join(input.outputDir, `${slug}.md`);
      const markdown = [
        buildFrontmatter(
          file.sourceReference ?? basename(file.filePath),
          definition.sourceType,
          description,
        ),
        "",
        `# ${title}`,
        "",
        content,
        "",
      ].join("\n");

      deps.signal?.throwIfAborted();
      await Deno.writeTextFile(outputPath, markdown, { signal: deps.signal });
      results.push({
        success: true,
        source_path: file.filePath,
        source_filename: basename(file.filePath),
        source_type: definition.sourceType,
        slug,
        sandbox_output_path: outputPath,
        suggested_project_path: `knowledge/${slug}.md`,
        description,
        title,
        summary: buildSummary(definition.sourceType, parsed.stats),
        stats: parsed.stats,
        warnings: parsed.warnings,
        document_kind: "generated",
      });
    } catch (error) {
      deps.signal?.throwIfAborted();
      if (error instanceof Error && error.message.startsWith("knowledge ingest parser failed")) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`knowledge ingest parser failed: ${message}`);
    }
  }

  return results;
}
