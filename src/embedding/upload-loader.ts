import { Buffer } from "node:buffer";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";

/**
 * Extracts plain text from various upload formats.
 *
 * Supports: plain text, markdown, CSV, PDF, and DOCX.
 * PDF extraction requires `pdf-parse` as a project dependency — if missing,
 * a helpful error is thrown. DOCX extraction is built-in using ZIP/XML parsing.
 *
 * @example
 * ```ts
 * const text = await loadUpload(buffer, "application/pdf");
 * ```
 */
export async function loadUpload(buffer: ArrayBuffer, mimeType: string): Promise<string> {
  switch (mimeType) {
    case "text/plain":
    case "text/markdown":
    case "text/mdx":
      return new TextDecoder().decode(buffer);

    case "text/csv":
    case "application/csv":
      return extractCSV(buffer);

    case "application/pdf":
      return await extractPDF(buffer);

    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return await extractDOCX(buffer);

    default:
      return new TextDecoder().decode(buffer);
  }
}

function extractCSV(buffer: ArrayBuffer): string {
  const text = new TextDecoder().decode(buffer);
  const lines = text.split("\n").filter((line) => line.trim());
  if (lines.length < 2) return text;

  const headers = parseCSVLine(lines[0]!);
  const rows = lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    return headers
      .map((header, i) => `${header}: ${values[i] ?? ""}`)
      .join(", ");
  });

  return rows.join("\n");
}

function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (char === '"') {
      // RFC 4180: doubled quote inside a quoted field is a literal quote
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // skip the second quote
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

async function extractPDF(buffer: ArrayBuffer): Promise<string> {
  // pdf-parse is an optional peer dependency. Supports both v1 (default function)
  // and v2 (PDFParse class). Resolved dynamically so the framework doesn't
  // hard-depend on it.
  const mod = await importPdfParse();

  // v1: default export is a callable function
  if (typeof mod.default === "function") {
    const result = await mod.default(Buffer.from(buffer));
    return result.text || "";
  }

  // v2: named PDFParse class — new PDFParse(data).load(), then getText()
  if (typeof mod.PDFParse === "function") {
    const PDFParse = mod.PDFParse as new (
      data: Uint8Array,
    ) => { load(): Promise<void>; getText(): Promise<{ text: string }> };
    const parser = new PDFParse(new Uint8Array(buffer));
    await parser.load();
    const result = await parser.getText();
    return result.text || "";
  }

  throw new Error("pdf-parse module has no recognised API (expected v1 default or v2 PDFParse)");
}

async function importPdfParse(): Promise<Record<string, unknown>> {
  try {
    return await import("pdf-parse") as Record<string, unknown>;
  } catch {
    if (isDeno) {
      try {
        // In Deno (including compiled binaries), resolve via npm: specifier.
        // Users install with: deno add npm:pdf-parse
        // deno-lint-ignore no-unversioned-import
        return await import("npm:pdf-parse") as Record<string, unknown>;
      } catch { /* fall through */ }
    }
    throw new Error(
      isDeno
        ? "pdf-parse is required for PDF extraction. Install it: deno add npm:pdf-parse"
        : "pdf-parse is required for PDF extraction. Install it: npm install pdf-parse",
    );
  }
}

async function extractDOCX(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);

  const xml = await findZipEntry(bytes, "word/document.xml");
  if (!xml) return "";

  const paragraphs = xml.split(/<\/w:p>/);
  const textParts: string[] = [];
  const tagRegex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;

  for (const paragraph of paragraphs) {
    const parts: string[] = [];
    let match;
    while ((match = tagRegex.exec(paragraph)) !== null) {
      parts.push(match[1]!);
    }
    tagRegex.lastIndex = 0;
    if (parts.length > 0) {
      textParts.push(parts.join(""));
    }
  }

  return textParts.join("\n").trim();
}

async function findZipEntry(
  bytes: Uint8Array,
  targetPath: string,
): Promise<string | null> {
  const PK_EOCD = 0x06054b50;
  const PK_CENTRAL = 0x02014b50;
  const PK_LOCAL = 0x04034b50;

  // Locate the End of Central Directory record (last 22+ bytes of file).
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 65557; i--) {
    if (readUint32LE(bytes, i) === PK_EOCD) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return null;

  const centralDirOffset = readUint32LE(bytes, eocdOffset + 16);
  const centralDirEntries = readUint16LE(bytes, eocdOffset + 10);

  // Scan central directory — it always has correct sizes, even when
  // local headers use data descriptors (bit 3 of the general purpose flag).
  let cdOffset = centralDirOffset;
  for (let i = 0; i < centralDirEntries; i++) {
    if (cdOffset + 46 > bytes.length) break;
    if (readUint32LE(bytes, cdOffset) !== PK_CENTRAL) break;

    const compressionMethod = readUint16LE(bytes, cdOffset + 10);
    const compressedSize = readUint32LE(bytes, cdOffset + 20);
    const fileNameLength = readUint16LE(bytes, cdOffset + 28);
    const extraFieldLength = readUint16LE(bytes, cdOffset + 30);
    const commentLength = readUint16LE(bytes, cdOffset + 32);
    const localHeaderOffset = readUint32LE(bytes, cdOffset + 42);

    const fileName = decodeBytes(bytes, cdOffset + 46, fileNameLength);

    if (fileName === targetPath) {
      // Read the local file header to find where data actually starts
      // (local extra field length can differ from central directory).
      if (localHeaderOffset + 30 > bytes.length) return null;
      if (readUint32LE(bytes, localHeaderOffset) !== PK_LOCAL) return null;

      const localFileNameLength = readUint16LE(bytes, localHeaderOffset + 26);
      const localExtraLength = readUint16LE(bytes, localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;

      if (dataStart + compressedSize > bytes.length) return null;

      const raw = bytes.subarray(dataStart, dataStart + compressedSize);

      if (compressionMethod === 0) {
        return new TextDecoder().decode(raw);
      }

      if (compressionMethod === 8) {
        // "raw" deflate is supported by modern runtimes but not in the TS type defs
        const ds = new DecompressionStream("deflate-raw" as CompressionFormat);
        const writer = ds.writable.getWriter();
        writer.write(raw as unknown as BufferSource);
        writer.close();
        const decompressed = await new Response(ds.readable).arrayBuffer();
        return new TextDecoder().decode(decompressed);
      }

      return null;
    }

    cdOffset += 46 + fileNameLength + extraFieldLength + commentLength;
  }

  return null;
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    ((bytes[offset + 3]! << 24) >>> 0)
  );
}

function decodeBytes(
  bytes: Uint8Array,
  offset: number,
  length: number,
): string {
  return new TextDecoder().decode(bytes.subarray(offset, offset + length));
}
