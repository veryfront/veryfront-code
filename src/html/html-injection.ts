import type { HTMLMetadata } from "#veryfront/transforms/mdx/types.ts";
import { resolveRelativePath } from "#veryfront/modules/react-loader/path-resolver.ts";
import { determineClientModuleStrategy } from "#veryfront/rendering/rsc/client-module-strategy.ts";
import {
  generateLinkTags,
  generateMetaTags,
  generateScriptTags,
  generateStyleTags,
} from "./tag-generators.ts";
import { buildNonceAttribute, escapeHTML } from "./html-escape.ts";
import {
  escapeInlineJsonText,
  jsonForInlineScript,
} from "#veryfront/security/client/html-sanitizer.ts";
import {
  getDevScripts,
  getDevStyles,
  getPreviewStylesheetLink,
  getProdScripts,
  getStudioScripts,
} from "./dev-scripts.ts";
import { INPUT_VALIDATION_FAILED } from "#veryfront/errors";
import {
  decodePathSegmentFully,
  hasPathControlCharacter,
  isSafeModulePathSegment,
} from "./path-safety.ts";
import {
  assertBoundedHTMLText,
  assertHTMLPartsSize,
  assertHTMLProjectedLength,
  assertHTMLStringSize,
  getUTF8ByteLength,
  MAX_HTML_HYDRATION_DATA_BYTES,
  MAX_HTML_NONCE_BYTES,
  MAX_HTML_PATH_BYTES,
  MAX_HTML_SLUG_BYTES,
} from "./limits.ts";
import { assertValidImportMapJson } from "./import-map-validation.ts";
import { snapshotHydrationParams } from "./hydration-params.ts";
import { snapshotPlainDataRecord } from "./json-snapshot.ts";
import { hasUnpairedUtf16Surrogate, hasUnsafeUnicodeFormatting } from "./unicode-safety.ts";

export interface InjectHTMLContentOptions {
  mode: "development" | "production";
  slug: string;
  devPort?: number;
  /** Absolute path to the page file, used for 'use client' hydration */
  pagePath?: string;
  /** Project root used to normalize absolute page paths in hydration data */
  projectDir?: string;
  /** Whether the page has 'use client' directive */
  isClientPage?: boolean;
  /**
   * Route params from the initial match, seeded into the 'use client' hydration
   * payload so full-HTML-document client pages hydrate with their params
   * instead of an empty object (issue #2741). Catch-all arrays are preserved;
   * the client runtime joins them (issue #2742).
   */
  params?: Record<string, string | string[]>;
  /** Whether page is embedded in Studio iframe */
  studioEmbed?: boolean;
  /** Project ID for Studio communication */
  projectId?: string;
  /** Page ID for Studio communication */
  pageId?: string;
  /** Source hash used to synchronize the Studio Navigator tree. */
  sourceHash?: string;
  /** CSP nonce */
  nonce?: string;
  /** Deployment environment for hydration module selection */
  environment?: "preview" | "production";
  /** Whether the request is being served from a local project */
  isLocalProject?: boolean;
  /** @deprecated The current Studio bridge does not provide direct Yjs collaboration. */
  wsUrl?: string;
  /** @deprecated The current Studio bridge does not provide direct Yjs collaboration. */
  yjsGuid?: string;
  /** Pre-built import map JSON for ESM module resolution (injected into <head>) */
  importMapJson?: string;
  /** Framework-generated project stylesheet for production shells */
  projectStylesheetHref?: string;
}

function isSafeInjectionPathSegment(segment: string): boolean {
  if (!isSafeModulePathSegment(segment)) return false;
  try {
    const decoded = decodePathSegmentFully(segment);
    return !hasUnpairedUtf16Surrogate(decoded) && !hasUnsafeUnicodeFormatting(decoded);
  } catch {
    return false;
  }
}

function toProjectRelativePath(absolutePath: unknown, projectDir?: unknown): string {
  if (typeof absolutePath !== "string") {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Unsafe page path" });
  }
  const normalizedPath = absolutePath.replace(/\\/g, "/");
  if (
    normalizedPath.length === 0 || normalizedPath.length > MAX_HTML_PATH_BYTES ||
    getUTF8ByteLength(normalizedPath) > MAX_HTML_PATH_BYTES || normalizedPath.startsWith("//") ||
    /[?#<>"']/.test(normalizedPath) || hasPathControlCharacter(normalizedPath) ||
    hasUnpairedUtf16Surrogate(normalizedPath) || hasUnsafeUnicodeFormatting(normalizedPath)
  ) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Unsafe page path" });
  }
  const rawSegments = normalizedPath
    .split("/")
    .slice(normalizedPath.startsWith("/") ? 1 : 0);
  if (rawSegments.some((segment) => !isSafeInjectionPathSegment(segment))) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Unsafe page path" });
  }

  if (projectDir === undefined) {
    if (normalizedPath.startsWith("/") || /^[A-Za-z]:\//.test(normalizedPath)) {
      throw INPUT_VALIDATION_FAILED.create({ detail: "Unsafe page path" });
    }
    return normalizedPath;
  }
  if (
    typeof projectDir !== "string" || projectDir.length === 0 ||
    projectDir.length > MAX_HTML_PATH_BYTES ||
    getUTF8ByteLength(projectDir) > MAX_HTML_PATH_BYTES ||
    hasPathControlCharacter(projectDir) || hasUnpairedUtf16Surrogate(projectDir) ||
    hasUnsafeUnicodeFormatting(projectDir)
  ) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Unsafe project directory" });
  }

  try {
    const relativePath = resolveRelativePath(normalizedPath, projectDir).replace(/\\/g, "/");
    if (relativePath.split("/").some((segment) => !isSafeInjectionPathSegment(segment))) {
      throw new TypeError("Unsafe project-relative page path");
    }
    return relativePath;
  } catch {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Unsafe page path" });
  }
}

function replaceDynamic(html: string, pattern: RegExp, replacement: string): string {
  const matcher = new RegExp(pattern.source, pattern.flags);
  let projectedLength = html.length;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(html)) !== null) {
    projectedLength += replacement.length - match[0].length;
    assertHTMLProjectedLength(projectedLength);
    if (!matcher.global) break;
    if (match[0].length === 0) matcher.lastIndex++;
  }
  return html.replace(pattern, () => replacement);
}

const HTML_RAW_TEXT_ELEMENTS = new Set([
  "iframe",
  "noembed",
  "noframes",
  "noscript",
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
]);

function isHTMLTagNameCharacter(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9:_-]/u.test(char);
}

function isHTMLSpace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\f" || char === "\r";
}

function isHTMLTagBoundary(char: string | undefined): boolean {
  return char === undefined || isHTMLSpace(char) || char === "/" || char === ">";
}

function findHTMLTagEnd(html: string, start: number): number {
  let quote: '"' | "'" | null = null;

  for (let index = start + 1; index < html.length; index++) {
    const char = html[index];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") return index;
  }

  return -1;
}

interface HTMLTagStart {
  closing: boolean;
  name: string;
}

function readHTMLTagStart(html: string, start: number): HTMLTagStart | null {
  let index = start + 1;
  let closing = false;
  if (html[index] === "/") {
    closing = true;
    index++;
  }
  if (!/[A-Za-z]/u.test(html[index] ?? "")) return null;

  const nameStart = index;
  while (isHTMLTagNameCharacter(html[index])) index++;
  if (!isHTMLTagBoundary(html[index])) return null;

  return {
    closing,
    name: html.slice(nameStart, index).toLowerCase(),
  };
}

function findRawTextClosingTag(
  html: string,
  tagName: string,
  fromIndex: number,
): number {
  let searchIndex = fromIndex;
  while (searchIndex < html.length) {
    const closingIndex = html.indexOf("</", searchIndex);
    if (closingIndex === -1) return -1;

    const nameStart = closingIndex + 2;
    const nameEnd = nameStart + tagName.length;
    if (
      html.slice(nameStart, nameEnd).toLowerCase() === tagName &&
      isHTMLTagBoundary(html[nameEnd])
    ) {
      return closingIndex;
    }
    searchIndex = nameStart;
  }
  return -1;
}

function isSelfClosingHTMLTag(html: string, start: number, end: number): boolean {
  let index = end - 1;
  while (index > start && isHTMLSpace(html[index])) index--;
  return html[index] === "/";
}

type HTMLDocumentSection = "head" | "body";

interface ActiveHTMLTag {
  closing: boolean;
  end: number;
  name: string;
  selfClosing: boolean;
  start: number;
}

interface ActiveHTMLVisitor {
  onTag?: (tag: ActiveHTMLTag) => boolean | void;
  onText?: (start: number, end: number) => boolean | void;
}

type HTMLWalkResult = "complete" | "malformed" | "stopped";

/** Walk active document markup while excluding comments, raw text, templates, and foreign content. */
function walkActiveHTMLDocument(html: string, visitor: ActiveHTMLVisitor): HTMLWalkResult {
  let index = 0;
  let rawTextElement: string | null = null;
  let templateDepth = 0;
  const foreignRoots: string[] = [];

  while (index < html.length) {
    if (rawTextElement) {
      const closingIndex = findRawTextClosingTag(html, rawTextElement, index);
      if (closingIndex === -1) return "malformed";
      index = closingIndex;
      rawTextElement = null;
      continue;
    }

    const tagStart = html.indexOf("<", index);
    if (tagStart === -1) break;

    if (
      templateDepth === 0 && foreignRoots.length === 0 && tagStart > index &&
      visitor.onText?.(index, tagStart) === false
    ) return "stopped";

    if (foreignRoots.length > 0 && html.startsWith("<![CDATA[", tagStart)) {
      const cdataEnd = html.indexOf("]]>", tagStart + 9);
      if (cdataEnd === -1) return "malformed";
      index = cdataEnd + 3;
      continue;
    }

    if (html.startsWith("<!--", tagStart)) {
      const standardCommentEnd = html.indexOf("-->", tagStart + 4);
      const alternateCommentEnd = html.indexOf("--!>", tagStart + 4);
      const commentEnd = standardCommentEnd === -1
        ? alternateCommentEnd
        : alternateCommentEnd === -1
        ? standardCommentEnd
        : Math.min(standardCommentEnd, alternateCommentEnd);
      if (commentEnd === -1) return "malformed";
      index = commentEnd + (commentEnd === alternateCommentEnd ? 4 : 3);
      continue;
    }

    if (html.startsWith("<!", tagStart) || html.startsWith("<?", tagStart)) {
      const declarationEnd = findHTMLTagEnd(html, tagStart);
      if (declarationEnd === -1) return "malformed";
      index = declarationEnd + 1;
      continue;
    }

    const tag = readHTMLTagStart(html, tagStart);
    if (!tag) {
      if (
        templateDepth === 0 && foreignRoots.length === 0 &&
        visitor.onText?.(tagStart, tagStart + 1) === false
      ) return "stopped";
      index = tagStart + 1;
      continue;
    }

    const tagEnd = findHTMLTagEnd(html, tagStart);
    if (tagEnd === -1) return "malformed";
    const selfClosing = isSelfClosingHTMLTag(html, tagStart, tagEnd);

    if (foreignRoots.length > 0) {
      if (tag.closing) {
        const rootIndex = foreignRoots.lastIndexOf(tag.name);
        if (rootIndex !== -1) foreignRoots.length = rootIndex;
      } else if (!selfClosing && (tag.name === "svg" || tag.name === "math")) {
        foreignRoots.push(tag.name);
      }

      if (!tag.closing && !selfClosing && HTML_RAW_TEXT_ELEMENTS.has(tag.name)) {
        rawTextElement = tag.name;
      }
      index = tagEnd + 1;
      continue;
    }

    const activeTag = {
      closing: tag.closing,
      end: tagEnd + 1,
      name: tag.name,
      selfClosing,
      start: tagStart,
    };
    if (tag.name === "template") {
      if (!tag.closing && templateDepth === 0 && visitor.onTag?.(activeTag) === false) {
        return "stopped";
      }
      templateDepth = tag.closing ? Math.max(0, templateDepth - 1) : templateDepth + 1;
    } else if (templateDepth === 0 && visitor.onTag?.(activeTag) === false) {
      return "stopped";
    }

    if (!tag.closing && !selfClosing && (tag.name === "svg" || tag.name === "math")) {
      foreignRoots.push(tag.name);
    } else if (!tag.closing && HTML_RAW_TEXT_ELEMENTS.has(tag.name)) {
      rawTextElement = tag.name;
    }
    index = tagEnd + 1;
  }

  if (
    templateDepth === 0 && foreignRoots.length === 0 && index < html.length &&
    visitor.onText?.(index, html.length) === false
  ) return "stopped";
  return templateDepth > 0 || foreignRoots.length > 0 ? "malformed" : "complete";
}

/** Find an active opening tag while ignoring comments, raw text, templates, and foreign content. */
export function findActiveDocumentOpeningTag(
  html: string,
  tagName: string,
): Readonly<{ start: number; end: number }> | null {
  const normalizedTagName = tagName.toLowerCase();
  if (!/^[a-z][a-z0-9:_-]*$/u.test(normalizedTagName)) return null;

  let result: Readonly<{ start: number; end: number }> | null = null;
  walkActiveHTMLDocument(html, {
    onTag(tag) {
      if (!tag.closing && tag.name === normalizedTagName) {
        result = { start: tag.start, end: tag.end };
        return false;
      }
    },
  });
  return result;
}

const HTML_HEAD_CONTENT_ELEMENTS = new Set([
  "base",
  "basefont",
  "bgsound",
  "link",
  "meta",
  "noframes",
  "noscript",
  "script",
  "style",
  "template",
  "title",
]);

const HTML_AFTER_HEAD_CONTENT_ELEMENTS = new Set([
  "base",
  "basefont",
  "bgsound",
  "link",
  "meta",
  "noframes",
  "template",
]);

function firstNonSpaceIndex(html: string, start: number, end: number): number | null {
  for (let index = start; index < end; index++) {
    if (!isHTMLSpace(html[index])) return index;
  }
  return null;
}

/** Locate a document section boundary while respecting text and foreign-content modes. */
function findDocumentSectionEndInsertionPoint(
  html: string,
  section: HTMLDocumentSection,
): number | null {
  let insertionPoint: number | null = null;
  let htmlEnd = -1;
  let hasDocumentElement = false;
  let headStarted = false;
  const walkResult = walkActiveHTMLDocument(html, {
    onText(start, end) {
      if (section !== "head" || !headStarted) return;
      const contentStart = firstNonSpaceIndex(html, start, end);
      if (contentStart === null) return;
      insertionPoint = contentStart;
      return false;
    },
    onTag(tag) {
      if (!tag.closing && tag.name === "html") {
        hasDocumentElement = true;
        headStarted = true;
        return;
      }
      if (!tag.closing && tag.name === "head") {
        headStarted = true;
        return;
      }
      if (!tag.closing && tag.name === "body") {
        hasDocumentElement = true;
        if (section === "head") {
          insertionPoint = tag.start;
          return false;
        }
        return;
      }
      if (tag.closing && tag.name === section) {
        insertionPoint = tag.start;
        return false;
      }
      if (tag.closing && tag.name === "html" && htmlEnd === -1) {
        htmlEnd = tag.start;
        return;
      }
      if (
        section === "head" && headStarted && !tag.closing &&
        !HTML_HEAD_CONTENT_ELEMENTS.has(tag.name)
      ) {
        insertionPoint = tag.start;
        return false;
      }
    },
  });

  if (insertionPoint !== null) return insertionPoint;
  if (!hasDocumentElement || walkResult === "malformed") return null;
  return htmlEnd === -1 ? html.length : htmlEnd;
}

/** Keep metadata that affects parsing and URL resolution ahead of the import map. */
function findImportMapInsertionPoint(html: string): number | null {
  let insertionPoint: number | null = null;
  let headStart: number | null = null;
  let lastMetadataEnd: number | null = null;
  let hasDocumentElement = false;
  let headStarted = false;
  let afterHead = false;

  const selectInsertionPoint = (): number | null => lastMetadataEnd ?? headStart;
  const walkResult = walkActiveHTMLDocument(html, {
    onText(start, end) {
      if (!headStarted || firstNonSpaceIndex(html, start, end) === null) return;
      insertionPoint = selectInsertionPoint();
      return false;
    },
    onTag(tag) {
      if (!tag.closing && tag.name === "html") {
        hasDocumentElement = true;
        if (!headStarted) {
          headStarted = true;
          headStart = tag.end;
        }
        return;
      }
      if (!tag.closing && tag.name === "head") {
        if (afterHead) return;
        headStarted = true;
        headStart = tag.end;
        lastMetadataEnd = null;
        return;
      }
      if (!tag.closing && tag.name === "body") {
        hasDocumentElement = true;
        insertionPoint = selectInsertionPoint() ?? tag.start;
        return false;
      }
      if (!headStarted) return;
      if (tag.closing && tag.name === "head") {
        afterHead = true;
        return;
      }
      if (tag.closing) return;
      if (tag.name === "base" || tag.name === "meta") {
        lastMetadataEnd = tag.end;
        return;
      }
      if (afterHead) {
        if (HTML_AFTER_HEAD_CONTENT_ELEMENTS.has(tag.name)) return;
        insertionPoint = selectInsertionPoint();
        return false;
      }
      if (tag.name === "script" || !HTML_HEAD_CONTENT_ELEMENTS.has(tag.name)) {
        insertionPoint = selectInsertionPoint();
        return false;
      }
    },
  });

  if (insertionPoint !== null) return insertionPoint;
  if (!hasDocumentElement || walkResult === "malformed") return null;
  return selectInsertionPoint();
}

function insertAtDocumentSectionEnd(
  html: string,
  section: HTMLDocumentSection,
  content: string,
): string {
  const insertionPoint = findDocumentSectionEndInsertionPoint(html, section);
  if (insertionPoint === null) return html;
  assertHTMLProjectedLength(html.length + content.length);
  return `${html.slice(0, insertionPoint)}${content}${html.slice(insertionPoint)}`;
}

/** Insert content at the parser-aware end of a document head. */
export function insertAtDocumentHeadEnd(html: string, content: string): string {
  return insertAtDocumentSectionEnd(html, "head", content);
}

function insertImportMapAtDocumentHead(html: string, content: string): string {
  const insertionPoint = findImportMapInsertionPoint(html);
  if (insertionPoint === null) return html;
  assertHTMLProjectedLength(html.length + content.length);
  return `${html.slice(0, insertionPoint)}${content}${html.slice(insertionPoint)}`;
}

function readTagAttributes(
  html: string,
  tag: ActiveHTMLTag,
  requestedNames: ReadonlySet<string>,
): Record<string, string> {
  const attributes: Record<string, string> = Object.create(null);
  let index = tag.start + 1 + tag.name.length;
  while (index < tag.end - 1) {
    while (isHTMLSpace(html[index])) index++;
    if (html[index] === ">" || html[index] === "/") break;

    const nameStart = index;
    while (
      index < tag.end - 1 && !isHTMLSpace(html[index]) &&
      !/["'<>/=]/u.test(html[index] ?? "")
    ) index++;
    if (index === nameStart) {
      index++;
      continue;
    }
    const name = html.slice(nameStart, index).toLowerCase();
    while (isHTMLSpace(html[index])) index++;

    let value = "";
    if (html[index] === "=") {
      index++;
      while (isHTMLSpace(html[index])) index++;
      const quote = html[index] === '"' || html[index] === "'" ? html[index++] : null;
      const valueStart = index;
      if (quote) {
        while (index < tag.end - 1 && html[index] !== quote) index++;
        value = html.slice(valueStart, index);
        if (html[index] === quote) index++;
      } else {
        while (index < tag.end - 1 && !isHTMLSpace(html[index]) && html[index] !== ">") {
          index++;
        }
        value = html.slice(valueStart, index);
      }
    }
    if (requestedNames.has(name) && !(name in attributes)) attributes[name] = value;
  }
  return attributes;
}

function isFrameworkStylesheetHref(value: string): boolean {
  try {
    const pathname = new URL(value, "https://veryfront.invalid").pathname;
    return pathname === "/_vf_styles/styles.css" ||
      /^\/_vf\/css\/[A-Za-z0-9_-]{1,128}\.css$/u.test(pathname);
  } catch {
    return false;
  }
}

function hasProjectStylesheet(html: string): boolean {
  let found = false;
  walkActiveHTMLDocument(html, {
    onTag(tag) {
      if (tag.closing || tag.name !== "link") return;
      const attributes = readTagAttributes(html, tag, new Set(["href", "id", "rel"]));
      const relationships = (attributes.rel ?? "").toLowerCase().split(/\s+/u);
      if (!relationships.includes("stylesheet")) return;
      if (
        attributes.id === "vf-tailwind-css" ||
        (attributes.href !== undefined && isFrameworkStylesheetHref(attributes.href))
      ) {
        found = true;
        return false;
      }
    },
  });
  return found;
}

export function injectHTMLContent(
  template: string,
  content: string,
  metadata: HTMLMetadata,
  options: InjectHTMLContentOptions,
): string {
  options = snapshotPlainDataRecord(
    options,
    "HTML injection options",
  ) as unknown as InjectHTMLContentOptions;
  metadata = snapshotPlainDataRecord(metadata, "HTML metadata") as unknown as HTMLMetadata;
  if (options.mode !== "development" && options.mode !== "production") {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid HTML injection mode" });
  }
  if (
    options.environment !== undefined && options.environment !== "preview" &&
    options.environment !== "production"
  ) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid HTML injection environment" });
  }
  if (options.wsUrl !== undefined || options.yjsGuid !== undefined) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "Studio bridge collaboration options are not supported",
    });
  }
  for (
    const [label, value] of [
      ["client page", options.isClientPage],
      ["local project", options.isLocalProject],
      ["Studio embed", options.studioEmbed],
    ] as const
  ) {
    if (value !== undefined && typeof value !== "boolean") {
      throw INPUT_VALIDATION_FAILED.create({ detail: `Invalid ${label} flag` });
    }
  }
  assertBoundedHTMLText(options.slug, "HTML slug", MAX_HTML_SLUG_BYTES, { allowEmpty: true });
  if (options.nonce !== undefined) {
    assertBoundedHTMLText(options.nonce, "HTML nonce", MAX_HTML_NONCE_BYTES, {
      allowEmpty: true,
    });
  }
  if (options.projectStylesheetHref !== undefined) {
    assertBoundedHTMLText(
      options.projectStylesheetHref,
      "Project stylesheet URL",
      MAX_HTML_PATH_BYTES,
    );
    if (!/^\/_vf\/css\/[A-Za-z0-9_-]{1,128}\.css$/.test(options.projectStylesheetHref)) {
      throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid project stylesheet URL" });
    }
  }
  if (options.importMapJson !== undefined) assertValidImportMapJson(options.importMapJson);
  assertHTMLStringSize(template, "HTML template");
  assertHTMLStringSize(content, "Rendered content");

  let html = template;

  html = replaceDynamic(html, /{{\s*content\s*}}/gi, content);
  // Escape title and description: these come from user-authored frontmatter and
  // may appear in both text nodes and attribute values (e.g. <title> and <meta
  // content="">). escapeHTML handles &, <, >, ", and ' for both contexts.
  html = replaceDynamic(html, /{{\s*title\s*}}/gi, escapeHTML(metadata.title ?? ""));
  html = replaceDynamic(
    html,
    /{{\s*description\s*}}/gi,
    escapeHTML(metadata.description ?? ""),
  );

  if (/{{\s*meta\s*}}/i.test(html)) {
    html = replaceDynamic(html, /{{\s*meta\s*}}/gi, generateMetaTags(metadata));
  }

  if (/{{\s*links\s*}}/i.test(html)) {
    html = replaceDynamic(html, /{{\s*links\s*}}/gi, generateLinkTags(metadata));
  }

  if (/{{\s*scripts\s*}}/i.test(html)) {
    html = replaceDynamic(
      html,
      /{{\s*scripts\s*}}/gi,
      generateScriptTags(metadata, options.nonce),
    );
  }

  if (/{{\s*styles\s*}}/i.test(html)) {
    html = replaceDynamic(
      html,
      /{{\s*styles\s*}}/gi,
      generateStyleTags(metadata, options.nonce),
    );
  }

  const hasHeadEndInsertionPoint = findDocumentSectionEndInsertionPoint(html, "head") !== null;

  // Inject import map into <head> for ESM module resolution (must be before any module scripts)
  if (options.importMapJson && hasHeadEndInsertionPoint) {
    const nonceAttr = buildNonceAttribute(options.nonce);
    const importMapTag = `<script type="importmap"${nonceAttr}>\n${
      escapeInlineJsonText(options.importMapJson)
    }\n</script>`;
    html = insertImportMapAtDocumentHead(html, `\n${importMapTag}\n`);
  }

  if (options.projectStylesheetHref && hasHeadEndInsertionPoint && !hasProjectStylesheet(html)) {
    const projectStylesheetTag = `<link rel="stylesheet" href="${
      escapeHTML(options.projectStylesheetHref)
    }">`;
    html = insertAtDocumentSectionEnd(html, "head", `${projectStylesheetTag}\n`);
  }

  const shouldUsePreviewStylesheet = options.mode === "development" ||
    options.environment === "preview";

  if (shouldUsePreviewStylesheet && hasHeadEndInsertionPoint && !hasProjectStylesheet(html)) {
    html = insertAtDocumentSectionEnd(html, "head", `${getPreviewStylesheetLink()}\n`);
  }

  const hasBodyEndInsertionPoint = findDocumentSectionEndInsertionPoint(html, "body") !== null;

  // Inject hydration data for 'use client' pages (before scripts, so client.js can find it)
  if (options.pagePath && options.isClientPage && hasBodyEndInsertionPoint) {
    const params = snapshotHydrationParams(options.params ?? {});
    // Serialize with jsonForInlineScript, not raw JSON.stringify: route params
    // (and slug) are URL-derived and decoded, so a segment like `%3C/script%3E`
    // would otherwise break out of the <script> tag (reflected XSS). This escapes
    // `<`, `>`, `&`, and line separators, matching the main shell hydration path.
    const hydrationData = jsonForInlineScript({
      pagePath: toProjectRelativePath(options.pagePath, options.projectDir),
      slug: options.slug,
      isClientPage: true,
      params,
      clientModuleStrategy: determineClientModuleStrategy({
        isLocalProject: options.isLocalProject ?? options.mode === "development",
        environment: options.environment,
      }),
    });
    assertHTMLStringSize(
      hydrationData,
      "Client-page hydration data",
      MAX_HTML_HYDRATION_DATA_BYTES,
    );
    const nonceAttr = buildNonceAttribute(options.nonce);
    const hydrationScript =
      `<script id="veryfront-hydration-data" type="application/json"${nonceAttr}>${hydrationData}</script>`;
    html = insertAtDocumentSectionEnd(html, "body", hydrationScript);
  }

  if (options.mode === "development") {
    const hasDevScriptsPlaceholder = /{{\s*devScripts\s*}}/i.test(html);

    if (hasDevScriptsPlaceholder) {
      html = replaceDynamic(
        html,
        /{{\s*devScripts\s*}}/gi,
        getDevScripts(options.devPort, options.nonce),
      );
    }

    html = replaceDynamic(html, /{{\s*devStyles\s*}}/gi, getDevStyles(options.nonce));

    if (!hasDevScriptsPlaceholder && hasBodyEndInsertionPoint) {
      html = insertAtDocumentSectionEnd(
        html,
        "body",
        `${getDevStyles(options.nonce)}${getDevScripts(options.devPort, options.nonce)}`,
      );
    }
  } else {
    html = html.replace(/{{\s*devScripts\s*}}/gi, "");
    html = html.replace(/{{\s*devStyles\s*}}/gi, "");

    const prodScripts = getProdScripts(options.slug, options.nonce);
    const hasProdScriptsPlaceholder = /{{\s*prodScripts\s*}}/i.test(html);

    if (hasProdScriptsPlaceholder) {
      html = replaceDynamic(html, /{{\s*prodScripts\s*}}/gi, prodScripts);
    } else if (hasBodyEndInsertionPoint) {
      html = insertAtDocumentSectionEnd(html, "body", prodScripts);
    }
  }

  // Inject Studio bridge script when embedded in Studio iframe
  if (options.studioEmbed && hasBodyEndInsertionPoint) {
    const studioPagePath = options.pagePath
      ? toProjectRelativePath(options.pagePath, options.projectDir)
      : undefined;
    const studioScripts = getStudioScripts({
      projectId: options.projectId ?? options.slug,
      pageId: options.pageId ?? options.slug,
      pagePath: studioPagePath,
      sourceHash: options.sourceHash,
      nonce: options.nonce,
    });
    html = insertAtDocumentSectionEnd(html, "body", studioScripts);
  }

  assertHTMLPartsSize([html]);
  return html;
}
