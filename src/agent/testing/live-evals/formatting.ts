import { Buffer } from "node:buffer";
import type { AgUiSseProgressSnapshot as EvalProgressSnapshot } from "#veryfront/agent";

function escapePdfText(input: string): string {
  return input.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(
    ")",
    "\\)",
  );
}

/** Create plain text pdf. */
export function createPlainTextPdf(lines: string[]): Buffer {
  const contentLines = [
    "BT",
    "/F1 18 Tf",
    "72 720 Td",
    `(${escapePdfText(lines[0] ?? "Untitled")}) Tj`,
    "/F1 12 Tf",
    ...lines.slice(1).flatMap((
      line,
    ) => ["0 -20 Td", `(${escapePdfText(line)}) Tj`]),
    "ET",
  ];
  const contentStream = contentLines.join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${
      Buffer.byteLength(contentStream, "utf8")
    } >>\nstream\n${contentStream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

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
  return Buffer.from(pdf, "utf8");
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
    ? ` tool=${input.progress.lastToolCallName}`
    : "";
  const toolSummary = input.progress.toolStarts.length > 0
    ? ` tools=${input.progress.toolStarts.join(",")}`
    : "";
  const textSummary = input.progress.textLength > 0 ? ` text=${input.progress.textLength}ch` : "";
  return `[progress] ${input.caseId} ${elapsedSeconds}s events=${input.progress.eventCount} last=${lastEvent}${lastTool}${toolSummary}${textSummary}`;
}

/** Builds failure suffix. */
export function buildFailureSuffix(progress: EvalProgressSnapshot): string {
  const details = [
    `events=${progress.eventCount}`,
    `last=${progress.lastEventType ?? "none"}`,
    progress.lastToolCallName ? `tool=${progress.lastToolCallName}` : null,
    progress.toolStarts.length > 0 ? `tools=${progress.toolStarts.join(",")}` : null,
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
