import { Buffer } from "node:buffer";
import type { AgUiSseProgressSnapshot as EvalProgressSnapshot } from "#veryfront/agent";
import { formatEvalPublicError } from "../../validation.ts";

const MAX_PROGRESS_TOOL_NAMES = 32;
const MAX_PDF_SOURCE_LINES = 10_000;
const MAX_PDF_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_PDF_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_PDF_LINE_CHARACTERS = 88;
const MAX_PDF_LINES_PER_PAGE = 32;
const MAX_PDF_PAGES = 1_000;

function safeProgressValue(value: string): string {
  return formatEvalPublicError(value);
}

function summarizeToolNames(values: string[]): string {
  const names = values.slice(0, MAX_PROGRESS_TOOL_NAMES).map(safeProgressValue);
  const omitted = values.length - names.length;
  return `${names.join(",")}${omitted > 0 ? `,+${omitted} more` : ""}`;
}

function escapePdfText(input: string): string {
  let output = "";
  for (const character of input) {
    switch (character) {
      case "\\":
        output += "\\\\";
        break;
      case "(":
        output += "\\(";
        break;
      case ")":
        output += "\\)";
        break;
      case "\n":
        output += "\\n";
        break;
      case "\r":
        output += "\\r";
        break;
      case "\t":
        output += "\\t";
        break;
      case "\b":
        output += "\\b";
        break;
      case "\f":
        output += "\\f";
        break;
      default: {
        const code = character.charCodeAt(0);
        output += code <= 0x1f || code === 0x7f
          ? `\\${code.toString(8).padStart(3, "0")}`
          : character;
      }
    }
  }
  return output;
}

function wrapPdfLine(line: string): string[] {
  const characters = Array.from(line);
  if (characters.length === 0) return [""];

  const wrapped: string[] = [];
  for (let index = 0; index < characters.length; index += MAX_PDF_LINE_CHARACTERS) {
    wrapped.push(characters.slice(index, index + MAX_PDF_LINE_CHARACTERS).join(""));
  }
  return wrapped;
}

function validatePdfLines(lines: string[]): string[] {
  if (!Array.isArray(lines) || lines.length > MAX_PDF_SOURCE_LINES) {
    throw new TypeError(`PDF lines must contain at most ${MAX_PDF_SOURCE_LINES} entries`);
  }

  let sourceBytes = 0;
  const renderedLines: string[] = [];
  for (const line of lines.length === 0 ? ["Untitled"] : lines) {
    if (typeof line !== "string") {
      throw new TypeError("Each PDF line must be a string");
    }
    sourceBytes += Buffer.byteLength(line, "utf8");
    if (sourceBytes > MAX_PDF_SOURCE_BYTES) {
      throw new TypeError(`PDF source text must not exceed ${MAX_PDF_SOURCE_BYTES} bytes`);
    }
    renderedLines.push(...wrapPdfLine(line));
  }

  const pageCount = Math.ceil(renderedLines.length / MAX_PDF_LINES_PER_PAGE);
  if (pageCount > MAX_PDF_PAGES) {
    throw new TypeError(`PDF output must not exceed ${MAX_PDF_PAGES} pages`);
  }
  return renderedLines;
}

/** Create plain text pdf. */
export function createPlainTextPdf(lines: string[]): Buffer {
  const renderedLines = validatePdfLines(lines);
  const pages = Array.from(
    { length: Math.ceil(renderedLines.length / MAX_PDF_LINES_PER_PAGE) },
    (_, index) =>
      renderedLines.slice(
        index * MAX_PDF_LINES_PER_PAGE,
        (index + 1) * MAX_PDF_LINES_PER_PAGE,
      ),
  );
  const fontObjectId = 3 + pages.length * 2;
  const pageObjectIds = pages.map((_, index) => 3 + index * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${
      pageObjectIds.map((id) => `${id} 0 R`).join(" ")
    }] /Count ${pages.length} >>`,
  ];

  pages.forEach((pageLines, pageIndex) => {
    const pageObjectId = 3 + pageIndex * 2;
    const contentObjectId = pageObjectId + 1;
    const [firstLine, ...remainingLines] = pageLines;
    if (firstLine === undefined) {
      throw new TypeError("PDF pages must contain at least one line");
    }
    const contentLines = [
      "BT",
      pageIndex === 0 ? "/F1 18 Tf" : "/F1 12 Tf",
      "72 720 Td",
      `(${escapePdfText(firstLine)}) Tj`,
      ...(pageIndex === 0 && pageLines.length > 1 ? ["/F1 12 Tf"] : []),
      ...remainingLines.flatMap((line) => [
        "0 -20 Td",
        `(${escapePdfText(line)}) Tj`,
      ]),
      "ET",
    ];
    const contentStream = contentLines.join("\n");

    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjectId} 0 R /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> >>`,
      `<< /Length ${
        Buffer.byteLength(contentStream, "utf8")
      } >>\nstream\n${contentStream}\nendstream`,
    );
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((objectBody, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${objectBody}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";

  offsets.slice(1).forEach((offset) => {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  });

  pdf += `trailer\n<< /Root 1 0 R /Size ${
    objects.length + 1
  } >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  const output = Buffer.from(pdf, "utf8");
  if (output.byteLength > MAX_PDF_OUTPUT_BYTES) {
    throw new TypeError(`PDF output must not exceed ${MAX_PDF_OUTPUT_BYTES} bytes`);
  }
  return output;
}

/** Builds progress line. */
export function buildProgressLine(input: {
  caseId: string;
  startedAt: number;
  progress: EvalProgressSnapshot;
}): string {
  const elapsedSeconds = Math.max(
    1,
    Math.round((Date.now() - input.startedAt) / 1000),
  );
  const lastEvent = input.progress.lastEventType ?? "none";
  const lastTool = input.progress.lastToolCallName
    ? ` tool=${safeProgressValue(input.progress.lastToolCallName)}`
    : "";
  const toolSummary = input.progress.toolStarts.length > 0
    ? ` tools=${summarizeToolNames(input.progress.toolStarts)}`
    : "";
  const textSummary = input.progress.textLength > 0 ? ` text=${input.progress.textLength}ch` : "";
  return `[progress] ${
    safeProgressValue(input.caseId)
  } ${elapsedSeconds}s events=${input.progress.eventCount} last=${
    safeProgressValue(lastEvent)
  }${lastTool}${toolSummary}${textSummary}`;
}

/** Builds failure suffix. */
export function buildFailureSuffix(progress: EvalProgressSnapshot): string {
  const details = [
    `events=${progress.eventCount}`,
    `last=${safeProgressValue(progress.lastEventType ?? "none")}`,
    progress.lastToolCallName ? `tool=${safeProgressValue(progress.lastToolCallName)}` : null,
    progress.toolStarts.length > 0 ? `tools=${summarizeToolNames(progress.toolStarts)}` : null,
    progress.textLength > 0 ? `text=${progress.textLength}ch` : null,
  ].filter((value) => value !== null);

  return details.length > 0 ? ` Progress: ${details.join(" ")}` : "";
}

/** Contains ordered subsequence helper. */
export function containsOrderedSubsequence(
  haystack: string[],
  needle: string[],
): boolean {
  let cursor = 0;

  for (const value of haystack) {
    if (value === needle[cursor]) {
      cursor += 1;
    }

    if (cursor === needle.length) {
      return true;
    }
  }

  return cursor === needle.length;
}
