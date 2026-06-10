import { escapeHtml } from "#veryfront/utils/html-escape.ts";

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
  lowerHtml: string,
  tagName: "script" | "style",
  fromIndex: number,
): number {
  const needle = `</${tagName}`;
  let searchIndex = fromIndex;

  while (searchIndex < lowerHtml.length) {
    const closingIndex = lowerHtml.indexOf(needle, searchIndex);
    if (closingIndex === -1) return -1;

    if (isTagBoundary(lowerHtml[closingIndex + needle.length])) {
      return closingIndex;
    }

    searchIndex = closingIndex + needle.length;
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

  const escapedNonce = escapeHtml(nonce);
  const lowerHtml = html.toLowerCase();
  let result = "";
  let index = 0;
  let rawTextTag: "script" | "style" | null = null;

  while (index < html.length) {
    if (rawTextTag) {
      const closingIndex = findRawTextClosingTagStart(lowerHtml, rawTextTag, index);
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
      result += html.slice(index, endIndex);
      index = endIndex;
      continue;
    }

    if (html[index] !== "<") {
      result += html[index];
      index++;
      continue;
    }

    const tagEnd = findTagEnd(html, index);
    if (tagEnd === -1) {
      result += html.slice(index);
      break;
    }

    const tag = html.slice(index, tagEnd + 1);
    const tagName = getOpeningTagName(tag);

    if (!tagName) {
      result += tag;
      index = tagEnd + 1;
      continue;
    }

    result += injectNonceIntoOpeningTag(tag, escapedNonce);
    index = tagEnd + 1;

    if (!/\/\s*>$/u.test(tag)) {
      rawTextTag = tagName;
    }
  }

  return result;
}

export function addNonceToHtmlStream(
  stream: ReadableStream<Uint8Array>,
  nonce?: string,
): ReadableStream<Uint8Array> {
  if (!nonce) return stream;

  const escapedNonce = escapeHtml(nonce);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let lowerBuffer = "";
  let rawTextTag: "script" | "style" | null = null;

  function transformBuffer(flush: boolean): string {
    let result = "";
    let index = 0;

    while (index < buffer.length) {
      if (rawTextTag) {
        const closingIndex = findRawTextClosingTagStart(lowerBuffer, rawTextTag, index);
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

      const tag = buffer.slice(index, tagEnd + 1);
      const tagName = getOpeningTagName(tag);

      if (!tagName) {
        result += tag;
        index = tagEnd + 1;
        continue;
      }

      result += injectNonceIntoOpeningTag(tag, escapedNonce);
      index = tagEnd + 1;

      if (!/\/\s*>$/u.test(tag)) {
        rawTextTag = tagName;
      }
    }

    if (index > 0) {
      buffer = buffer.slice(index);
      lowerBuffer = buffer.toLowerCase();
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
            lowerBuffer += decoded.toLowerCase();
            const transformed = transformBuffer(true);
            if (transformed) controller.enqueue(encoder.encode(transformed));
            controller.close();
            releaseReaderLock();
            return;
          }

          const decoded = decoder.decode(value, { stream: true });
          buffer += decoded;
          lowerBuffer += decoded.toLowerCase();
          const transformed = transformBuffer(false);
          if (transformed) {
            controller.enqueue(encoder.encode(transformed));
            return;
          }
        }
      } catch (error) {
        releaseReaderLock();
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
