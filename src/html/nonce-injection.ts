import { escapeHTML } from "./html-escape.ts";
import { assertBoundedHTMLText, MAX_HTML_NONCE_BYTES } from "./limits.ts";

const MAX_BUFFERED_HTML_TOKEN_LENGTH = 64 * 1024;

function assertHTMLTokenLength(length: number): void {
  if (length > MAX_BUFFERED_HTML_TOKEN_LENGTH) {
    throw new TypeError("HTML token exceeds the streaming nonce-injection limit");
  }
}

function findTagEnd(html: string, start: number): number {
  let activeQuote: '"' | "'" | null = null;

  for (let index = start + 1; index < html.length; index++) {
    const char = html[index];

    if (activeQuote) {
      if (char === activeQuote) activeQuote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      activeQuote = char;
      continue;
    }

    if (char === ">") return index;
  }

  return -1;
}

function getOpeningTagName(tag: string): "script" | "style" | undefined {
  const match = /^<\s*([a-zA-Z][\w:-]*)/u.exec(tag);
  const tagName = match?.[1]?.toLowerCase();
  if (tagName === "script" || tagName === "style") return tagName;
  return undefined;
}

function isTagBoundary(char: string | undefined): boolean {
  return char === undefined || /\s|\/|>/u.test(char);
}

function findRawTextClosingTagStart(
  html: string,
  tagName: "script" | "style",
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
      isTagBoundary(html[nameEnd])
    ) {
      return closingIndex;
    }

    searchIndex = nameStart;
  }

  return -1;
}

interface ParsedAttribute {
  name: string;
  start: number;
  end: number;
  value: string | null;
}

function findAttribute(tag: string, attributeName: string): ParsedAttribute | undefined {
  const closeIndex = tag.lastIndexOf(">");
  if (closeIndex <= 0) return undefined;

  let index = 1;
  while (index < closeIndex && !/\s|\/|>/u.test(tag[index] ?? "")) index++;

  while (index < closeIndex) {
    while (index < closeIndex && /\s/u.test(tag[index] ?? "")) index++;
    if (index >= closeIndex) break;

    const char = tag[index];
    if (char === "/" || char === ">") break;

    const start = index;
    while (index < closeIndex && !/[\s=/>]/u.test(tag[index] ?? "")) index++;
    const name = tag.slice(start, index);

    while (index < closeIndex && /\s/u.test(tag[index] ?? "")) index++;

    let value: string | null = null;
    if (tag[index] === "=") {
      index++;
      while (index < closeIndex && /\s/u.test(tag[index] ?? "")) index++;

      const quote = tag[index];
      if (quote === '"' || quote === "'") {
        index++;
        const valueStart = index;
        while (index < closeIndex && tag[index] !== quote) index++;
        value = tag.slice(valueStart, index);
        if (index < closeIndex) index++;
      } else {
        const valueStart = index;
        while (index < closeIndex && !/[\s>]/u.test(tag[index] ?? "")) index++;
        value = tag.slice(valueStart, index);
      }
    }

    if (name.toLowerCase() === attributeName) {
      return { name, start, end: index, value };
    }
  }

  return undefined;
}

function injectNonceIntoOpeningTag(tag: string, escapedNonce: string): string {
  const existingNonce = findAttribute(tag, "nonce");
  if (existingNonce) {
    return `${tag.slice(0, existingNonce.start)}nonce="${escapedNonce}"${
      tag.slice(existingNonce.end)
    }`;
  }

  const closeIndex = tag.lastIndexOf(">");
  if (closeIndex === -1) return tag;

  const insertAt = /\/\s*>$/u.test(tag) ? closeIndex - 1 : closeIndex;
  return `${tag.slice(0, insertAt)} nonce="${escapedNonce}"${tag.slice(insertAt)}`;
}

export function addNonceToHtmlTags(html: string, nonce?: string): string {
  if (!nonce) return html;

  assertBoundedHTMLText(nonce, "HTML nonce", MAX_HTML_NONCE_BYTES);
  const escapedNonce = escapeHTML(nonce);
  let result = "";
  let index = 0;
  let rawTextTag: "script" | "style" | null = null;

  while (index < html.length) {
    if (rawTextTag) {
      const closingIndex = findRawTextClosingTagStart(html, rawTextTag, index);
      if (closingIndex === -1) {
        result += html.slice(index);
        break;
      }

      result += html.slice(index, closingIndex);
      index = closingIndex;
      rawTextTag = null;
      continue;
    }

    if (html.startsWith("<!--", index)) {
      const commentEnd = html.indexOf("-->", index + 4);
      const endIndex = commentEnd === -1 ? html.length : commentEnd + 3;
      assertHTMLTokenLength(endIndex - index);
      result += html.slice(index, endIndex);
      index = endIndex;
      continue;
    }

    if (html[index] !== "<") {
      const nextTagIndex = html.indexOf("<", index);
      const endIndex = nextTagIndex === -1 ? html.length : nextTagIndex;
      result += html.slice(index, endIndex);
      index = endIndex;
      continue;
    }

    const tagEnd = findTagEnd(html, index);
    if (tagEnd === -1) {
      assertHTMLTokenLength(html.length - index);
      result += html.slice(index);
      break;
    }
    assertHTMLTokenLength(tagEnd + 1 - index);

    const tag = html.slice(index, tagEnd + 1);
    const tagName = getOpeningTagName(tag);

    if (!tagName) {
      result += tag;
      index = tagEnd + 1;
      continue;
    }

    result += injectNonceIntoOpeningTag(tag, escapedNonce);
    index = tagEnd + 1;

    // The HTML parser ignores self-closing syntax on script and style tags.
    // Keep raw-text mode active even for `<script/>` and `<style/>`.
    rawTextTag = tagName;
  }

  return result;
}

export function addNonceToHtmlStream(
  stream: ReadableStream<Uint8Array>,
  nonce?: string,
): ReadableStream<Uint8Array> {
  if (!nonce) return stream;

  assertBoundedHTMLText(nonce, "HTML nonce", MAX_HTML_NONCE_BYTES);
  const escapedNonce = escapeHTML(nonce);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let rawTextTag: "script" | "style" | null = null;

  function transformBuffer(flush: boolean): string {
    let result = "";
    let index = 0;

    while (index < buffer.length) {
      if (rawTextTag) {
        const closingIndex = findRawTextClosingTagStart(buffer, rawTextTag, index);
        if (closingIndex === -1) {
          if (flush) {
            result += buffer.slice(index);
            index = buffer.length;
            break;
          }

          const retainLength = `</${rawTextTag}`.length;
          const safeEnd = Math.max(index, buffer.length - retainLength);
          result += buffer.slice(index, safeEnd);
          index = safeEnd;
          break;
        }

        result += buffer.slice(index, closingIndex);
        index = closingIndex;
        rawTextTag = null;
        continue;
      }

      if (buffer.startsWith("<!--", index)) {
        const commentEnd = buffer.indexOf("-->", index + 4);
        if (commentEnd === -1) {
          if (flush) {
            result += buffer.slice(index);
            index = buffer.length;
          }
          break;
        }

        const endIndex = commentEnd + 3;
        assertHTMLTokenLength(endIndex - index);
        result += buffer.slice(index, endIndex);
        index = endIndex;
        continue;
      }

      if (buffer[index] !== "<") {
        const nextTagIndex = buffer.indexOf("<", index);
        const endIndex = nextTagIndex === -1 ? buffer.length : nextTagIndex;
        result += buffer.slice(index, endIndex);
        index = endIndex;
        continue;
      }

      const tagEnd = findTagEnd(buffer, index);
      if (tagEnd === -1) {
        if (flush) {
          result += buffer.slice(index);
          index = buffer.length;
        }
        break;
      }

      assertHTMLTokenLength(tagEnd + 1 - index);
      const tag = buffer.slice(index, tagEnd + 1);
      const tagName = getOpeningTagName(tag);

      if (!tagName) {
        result += tag;
        index = tagEnd + 1;
        continue;
      }

      result += injectNonceIntoOpeningTag(tag, escapedNonce);
      index = tagEnd + 1;

      rawTextTag = tagName;
    }

    if (index > 0) {
      buffer = buffer.slice(index);
    }
    return result;
  }

  const reader = stream.getReader();
  let readerLockReleased = false;

  function releaseReaderLock(): void {
    if (readerLockReleased) return;
    readerLockReleased = true;
    reader.releaseLock();
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            const decoded = decoder.decode();
            buffer += decoded;
            const transformed = transformBuffer(true);
            if (transformed) controller.enqueue(encoder.encode(transformed));
            controller.close();
            releaseReaderLock();
            return;
          }

          const decoded = decoder.decode(value, { stream: true });
          buffer += decoded;
          const transformed = transformBuffer(false);
          assertHTMLTokenLength(buffer.length);
          if (transformed) {
            controller.enqueue(encoder.encode(transformed));
            return;
          }
        }
      } catch (error) {
        try {
          await reader.cancel(error);
        } catch {
          // Preserve the transformation error when upstream cancellation fails.
        } finally {
          releaseReaderLock();
        }
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        releaseReaderLock();
      }
    },
  });
}
