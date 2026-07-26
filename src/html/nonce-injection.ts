import { escapeHtml } from "#veryfront/utils/html-escape.ts";
import {
  findHtmlAttribute,
  findHtmlRawTextClosingTagStart,
  findHtmlTagEnd,
  getHtmlAttributeInsertionIndex,
  getOpeningHtmlTagName,
  isSelfClosingHtmlTag,
} from "./tag-scanner.ts";

function getOpeningTagName(tag: string): "script" | "style" | undefined {
  const tagName = getOpeningHtmlTagName(tag);
  if (tagName === "script" || tagName === "style") return tagName;
  return undefined;
}

function injectNonceIntoOpeningTag(tag: string, escapedNonce: string): string {
  const existingNonce = findHtmlAttribute(tag, "nonce");
  if (existingNonce) {
    return `${tag.slice(0, existingNonce.start)}nonce="${escapedNonce}"${
      tag.slice(existingNonce.end)
    }`;
  }

  const insertAt = getHtmlAttributeInsertionIndex(tag);
  if (insertAt === -1) return tag;
  return `${tag.slice(0, insertAt)} nonce="${escapedNonce}"${tag.slice(insertAt)}`;
}

type NonceTagCandidate = "script" | "style" | "incomplete" | null;

function classifyNonceTagCandidate(
  html: string,
  start: number,
  flush: boolean,
): NonceTagCandidate {
  const remaining = html.slice(start);
  if (!flush && "<!--".startsWith(remaining)) return "incomplete";

  const firstNameCharacter = html[start + 1];
  if (firstNameCharacter === undefined) return flush ? null : "incomplete";
  if (!/[a-z]/i.test(firstNameCharacter)) return null;

  let nameEnd = start + 1;
  while (nameEnd < html.length && /[\w:-]/u.test(html[nameEnd] ?? "")) nameEnd++;
  const name = html.slice(start + 1, nameEnd).toLowerCase();
  const candidates = ["script", "style"] as const;

  if (nameEnd === html.length && !flush) {
    return candidates.some((candidate) => candidate.startsWith(name)) ? "incomplete" : null;
  }
  if (!candidates.includes(name as "script" | "style")) return null;
  return /\s|\/|>/u.test(html[nameEnd] ?? "") ? name as "script" | "style" : null;
}

export function addNonceToHtmlTags(html: string, nonce?: string): string {
  if (!nonce) return html;

  const escapedNonce = escapeHtml(nonce);
  let result = "";
  let index = 0;
  let rawTextTag: "script" | "style" | null = null;

  while (index < html.length) {
    if (rawTextTag) {
      const closingIndex = findHtmlRawTextClosingTagStart(html, rawTextTag, index);
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

    const tagEnd = findHtmlTagEnd(html, index);
    if (tagEnd === -1) {
      result += html.slice(index);
      break;
    }

    const tag = html.slice(index, tagEnd + 1);
    const tagName = getOpeningTagName(tag);

    if (!tagName) {
      // A text comparison such as `< 2` may precede a real tag before the
      // next `>`. Consume only the non-tag `<` so that later markup remains
      // discoverable and byte-for-byte preserved.
      result += "<";
      index++;
      continue;
    }

    result += injectNonceIntoOpeningTag(tag, escapedNonce);
    index = tagEnd + 1;

    if (!isSelfClosingHtmlTag(tag)) {
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
  let rawTextTag: "script" | "style" | null = null;

  function transformBuffer(flush: boolean): string {
    let result = "";
    let index = 0;

    while (index < buffer.length) {
      if (rawTextTag) {
        const closingIndex = findHtmlRawTextClosingTagStart(buffer, rawTextTag, index);
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

      const candidate = classifyNonceTagCandidate(buffer, index, flush);
      if (candidate === "incomplete") break;
      if (candidate === null) {
        result += "<";
        index++;
        continue;
      }

      const tagEnd = findHtmlTagEnd(buffer, index);
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

      if (!isSelfClosingHtmlTag(tag)) {
        rawTextTag = tagName;
      }
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
