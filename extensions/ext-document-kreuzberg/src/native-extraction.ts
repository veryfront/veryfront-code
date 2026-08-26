/**
 * Native document extraction routines shared by the extraction subprocess and
 * the legacy in-isolate Worker wrapper.
 *
 * Supports two modes:
 * - `"whole-file"`: a single native parse of the full document (used when the
 *   caller did not request progress, so large valid files cost one parse).
 * - `"progress"`: page/slide-sized extraction that emits progress events after
 *   each unit.
 *
 * @module extensions/ext-document-kreuzberg/native-extraction
 */

import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import type {
  DocumentExtractionProgressEvent,
  KreuzbergExtractor,
} from "veryfront/extensions/compat";
import { extractionConfigForMimeType } from "./extraction-config.ts";
import { loadKreuzbergNative } from "./kreuzberg.ts";

/** How a native extraction request should be executed. */
export type NativeExtractionMode = "whole-file" | "progress";

export interface NativeExtractionRequest {
  mode: NativeExtractionMode;
  emitProgress: (event: DocumentExtractionProgressEvent) => void;
  /** Test seam — defaults to the shared native kreuzberg loader. */
  loadNative?: () => Promise<KreuzbergExtractor>;
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
}

function isPdfMimeType(mimeType: string): boolean {
  return normalizeMimeType(mimeType) === "application/pdf";
}

function isPptxMimeType(mimeType: string): boolean {
  return normalizeMimeType(mimeType) ===
    "application/vnd.openxmlformats-officedocument.presentationml.presentation";
}

function decodeXmlText(value: string): string {
  return value.replace(
    /&#x([0-9a-f]+);/gi,
    (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)),
  ).replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function extractPptxSlideText(xml: string): string {
  return Array.from(xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g))
    .map((match) => decodeXmlText(match[1] ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

function normalizePptxText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanExtractedMarkdown(value: string): string {
  return value
    .replace(/!\[[^\]\n]*\]\(\s*\)/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type PptxTextShapeRole = "title" | "subtitle" | "body";

interface PptxTextShape {
  role: PptxTextShapeRole;
  text: string;
}

function slideNumber(path: string): number {
  return Number(path.match(/\/slide(\d+)\.xml$/)?.[1] ?? 0);
}

function getXmlAttribute(tag: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return tag.match(new RegExp(`\\s${escapedName}=(["'])(.*?)\\1`))?.[2];
}

function pptxShapeRole(shapeXml: string): PptxTextShapeRole {
  const placeholderTag = shapeXml.match(/<(?:\w+:)?ph\b[^>]*>/)?.[0] ?? "";
  const placeholderType = getXmlAttribute(placeholderTag, "type");
  if (placeholderType === "title" || placeholderType === "ctrTitle") return "title";
  if (placeholderType === "subTitle") return "subtitle";

  const propertyTag = shapeXml.match(/<(?:\w+:)?cNvPr\b[^>]*>/)?.[0] ?? "";
  const name = getXmlAttribute(propertyTag, "name")?.toLowerCase() ?? "";
  if (name.includes("subtitle")) return "subtitle";
  if (name.includes("title")) return "title";

  return "body";
}

function pptxTextShapes(xml: string): PptxTextShape[] {
  const shapes = Array.from(xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g))
    .map((match) => {
      const shapeXml = match[0];
      return {
        role: pptxShapeRole(shapeXml),
        text: extractPptxSlideText(shapeXml),
      };
    })
    .filter((shape) => shape.text.length > 0);

  const hasExplicitHeading = shapes.some((shape) =>
    shape.role === "title" || shape.role === "subtitle"
  );
  if (!hasExplicitHeading && shapes.length === 1) {
    return [{ ...shapes[0]!, role: "title" }];
  }
  return shapes;
}

function pptxShapeRoleQueues(xml: string): Map<string, PptxTextShapeRole[]> {
  const roles = new Map<string, PptxTextShapeRole[]>();
  for (const shape of pptxTextShapes(xml)) {
    const key = normalizePptxText(shape.text);
    if (!key) continue;
    const queue = roles.get(key) ?? [];
    queue.push(shape.role);
    roles.set(key, queue);
  }
  return roles;
}

function normalizePptxMarkdownHeadings(markdown: string, xml: string): string {
  const roles = pptxShapeRoleQueues(xml);
  if (roles.size === 0) return markdown;

  return cleanExtractedMarkdown(
    markdown.split("\n").map((line) => {
      const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
      if (!heading) return line;

      const text = heading[1] ?? "";
      const queue = roles.get(normalizePptxText(text));
      const role = queue?.shift();
      if (!role) return line;
      if (role === "title") return `# ${text}`;
      if (role === "subtitle") return `## ${text}`;
      return text;
    }).join("\n"),
  );
}

function formatPptxShapeText(shape: PptxTextShape): string {
  if (shape.role === "title") return `# ${shape.text}`;
  if (shape.role === "subtitle") return `## ${shape.text}`;
  return shape.text;
}

function formatPptxSlideText(xml: string): string {
  const shapes = pptxTextShapes(xml);
  const nonShapeText = extractPptxSlideText(xml.replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, ""));
  if (shapes.length === 0) return nonShapeText || extractPptxSlideText(xml);
  return [...shapes.map(formatPptxShapeText), nonShapeText].filter(Boolean).join("\n\n").trim();
}

function normalizeZipPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function normalizePresentationTarget(target: string): string {
  const path = target.split(/[?#]/)[0] ?? target;
  if (path.startsWith("/")) return normalizeZipPath(path.slice(1));
  if (path.startsWith("ppt/")) return normalizeZipPath(path);
  return normalizeZipPath(`ppt/${path}`);
}

function presentationSlideRelationshipIds(xml: string): string[] {
  return Array.from(xml.matchAll(/<(?:\w+:)?sldId\b[^>]*>/g))
    .map((match) => getXmlAttribute(match[0], "r:id"))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

function presentationRelationships(xml: string): Map<string, string> {
  const relationships = new Map<string, string>();
  for (const match of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0];
    const id = getXmlAttribute(tag, "Id");
    const target = getXmlAttribute(tag, "Target");
    if (!id || !target) continue;

    const path = normalizePresentationTarget(target);
    if (/^ppt\/slides\/slide\d+\.xml$/.test(path)) {
      relationships.set(id, path);
    }
  }
  return relationships;
}

async function pptxSlidePaths(zip: JSZip): Promise<string[]> {
  const fallback = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((left, right) => slideNumber(left) - slideNumber(right));
  const presentation = zip.file("ppt/presentation.xml");
  const rels = zip.file("ppt/_rels/presentation.xml.rels");
  if (!presentation || !rels) return fallback;

  const [presentationXml, relsXml] = await Promise.all([
    presentation.async("text"),
    rels.async("text"),
  ]);
  const relationships = presentationRelationships(relsXml);
  const fallbackSet = new Set(fallback);
  const ordered: string[] = [];

  for (const id of presentationSlideRelationshipIds(presentationXml)) {
    const path = relationships.get(id);
    if (path && fallbackSet.has(path) && !ordered.includes(path)) {
      ordered.push(path);
    }
  }

  if (!ordered.length) return fallback;
  return [
    ...ordered,
    ...fallback.filter((path) => !ordered.includes(path)),
  ];
}

async function buildSingleSlidePptx(slideXml: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
</p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`,
  );
  zip.file("ppt/slides/slide1.xml", slideXml);
  return await zip.generateAsync({ type: "uint8array" });
}

async function extractPdfByPage(
  buffer: ArrayBuffer,
  loadNative: () => Promise<KreuzbergExtractor>,
  emitProgress: NativeExtractionRequest["emitProgress"],
): Promise<string> {
  const { extractBytes } = await loadNative();
  const source = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const total = source.getPageCount();
  const pages: string[] = [];
  const pdfConfig = extractionConfigForMimeType("application/pdf");

  for (let index = 0; index < total; index += 1) {
    const singlePage = await PDFDocument.create();
    const [page] = await singlePage.copyPages(source, [index]);
    singlePage.addPage(page);
    const bytes = await singlePage.save({ useObjectStreams: false });
    const result = await extractBytes(
      new Uint8Array(bytes),
      "application/pdf",
      pdfConfig,
    );
    const content = result.content.trim();
    pages.push(content);
    emitProgress({
      unit: "page",
      current: index + 1,
      total,
      characters: content.length,
    });
  }

  return pages.filter(Boolean).join("\n\n");
}

async function extractPptxBySlide(
  buffer: ArrayBuffer,
  mimeType: string,
  loadNative: () => Promise<KreuzbergExtractor>,
  emitProgress: NativeExtractionRequest["emitProgress"],
): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = await pptxSlidePaths(zip);
  const config = extractionConfigForMimeType(mimeType);
  let nativeExtractor: KreuzbergExtractor | undefined;

  try {
    nativeExtractor = await loadNative();
  } catch (error) {
    if (!slidePaths.length) throw error;
  }

  if (!slidePaths.length) {
    const result = await nativeExtractor!.extractBytes(
      new Uint8Array(buffer),
      mimeType,
      config,
    );
    const content = cleanExtractedMarkdown(result.content);
    emitProgress({ unit: "file", current: 1, total: 1, characters: content.length });
    return content;
  }

  const slides: string[] = [];
  for (const [index, path] of slidePaths.entries()) {
    const file = zip.file(path);
    const xml = file ? await file.async("text") : "";
    let content: string | undefined;

    if (nativeExtractor) {
      try {
        const slideBytes = await buildSingleSlidePptx(xml);
        const result = await nativeExtractor.extractBytes(slideBytes, mimeType, config);
        content = normalizePptxMarkdownHeadings(cleanExtractedMarkdown(result.content), xml);
      } catch {
        // Fall back below to direct slide text so this slide still reports progress.
      }
    }

    content ||= formatPptxSlideText(xml);
    slides.push(content);
    emitProgress({
      unit: "slide",
      current: index + 1,
      total: slidePaths.length,
      characters: content.length,
    });
  }

  return slides.filter(Boolean).join("\n\n");
}

async function extractWholeFile(
  buffer: ArrayBuffer,
  mimeType: string,
  loadNative: () => Promise<KreuzbergExtractor>,
  emitProgress: NativeExtractionRequest["emitProgress"],
): Promise<string> {
  const { extractBytes } = await loadNative();
  const result = await extractBytes(
    new Uint8Array(buffer),
    mimeType,
    extractionConfigForMimeType(mimeType),
  );
  emitProgress({ unit: "file", current: 1, total: 1, characters: result.content.length });
  return result.content;
}

/**
 * Extract a document with the native kreuzberg parser.
 *
 * `"whole-file"` mode always performs a single native parse; `"progress"` mode
 * splits PDFs by page and PPTX files by slide so each unit reports progress.
 */
export async function extractNativeDocument(
  buffer: ArrayBuffer,
  mimeType: string,
  request: NativeExtractionRequest,
): Promise<string> {
  const loadNative = request.loadNative ?? loadKreuzbergNative;
  if (request.mode !== "progress") {
    return await extractWholeFile(buffer, mimeType, loadNative, request.emitProgress);
  }
  if (isPdfMimeType(mimeType)) {
    return await extractPdfByPage(buffer, loadNative, request.emitProgress);
  }
  if (isPptxMimeType(mimeType)) {
    return await extractPptxBySlide(buffer, mimeType, loadNative, request.emitProgress);
  }
  return await extractWholeFile(buffer, mimeType, loadNative, request.emitProgress);
}
