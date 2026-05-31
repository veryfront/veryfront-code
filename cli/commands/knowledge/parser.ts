import { basename, extname, join } from "veryfront/platform/path";
import { KreuzbergDocumentExtractor } from "../../../extensions/ext-document-kreuzberg/src/index.ts";

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
}

export interface KnowledgeParserInput {
  filePath: string;
  description?: string;
  slug?: string;
  sourceReference?: string;
}

export type ExtractDocumentText = (
  input: { filePath: string; mimeType: string },
) => Promise<string>;

export interface RunKnowledgeParsersDeps {
  extractDocumentText?: ExtractDocumentText;
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
  parse: (path: string, deps: Required<RunKnowledgeParsersDeps>) => Promise<ParserOutput>;
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

function buildFrontmatter(source: string, sourceType: string, description: string): string {
  return [
    "---",
    `source: ${yamlQuote(source)}`,
    `source_type: ${yamlQuote(sourceType)}`,
    `added: ${yamlQuote(new Date().toISOString().slice(0, 10))}`,
    `description: ${yamlQuote(description)}`,
    "---",
  ].join("\n");
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
  deps: Required<RunKnowledgeParsersDeps>,
): Promise<ParserOutput> {
  const mimeType = MIME_BY_EXTENSION[extname(path).toLowerCase()] ?? "application/octet-stream";
  const content = cleanText(await deps.extractDocumentText({ filePath: path, mimeType }));
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
  input: { filePath: string; mimeType: string },
): Promise<string> {
  const bytes = await Deno.readFile(input.filePath);
  const extractor = new KreuzbergDocumentExtractor();
  return await extractor.extractInWorker(
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ),
    input.mimeType,
  );
}

export async function runKnowledgeParser(input: {
  filePath: string;
  outputDir: string;
  description?: string;
  slug?: string;
  sourceReference?: string;
}, deps: RunKnowledgeParsersDeps = {}): Promise<KnowledgeParserResult> {
  const [result] = await runKnowledgeParsers({
    files: [{
      filePath: input.filePath,
      description: input.description,
      slug: input.slug,
      sourceReference: input.sourceReference,
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
  if (!input.files.length) {
    return [];
  }

  const parserDeps: Required<RunKnowledgeParsersDeps> = {
    extractDocumentText: deps.extractDocumentText ?? defaultExtractDocumentText,
  };

  await Deno.mkdir(input.outputDir, { recursive: true });
  const results: KnowledgeParserResult[] = [];

  for (const file of input.files) {
    try {
      const stat = await Deno.stat(file.filePath);
      if (!stat.isFile) {
        throw new Error(`File not found: ${file.filePath}`);
      }

      const definition = selectParserDefinition(file.filePath);
      const parsed = await definition.parse(file.filePath, parserDeps);
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

      await Deno.writeTextFile(outputPath, markdown);
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
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("knowledge ingest parser failed")) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`knowledge ingest parser failed: ${message}`);
    }
  }

  return results;
}
