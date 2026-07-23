import {
  assertBoundedHTMLText,
  assertHTMLStringSize,
  getUTF8ByteLength,
  MAX_HTML_NONCE_BYTES,
} from "./limits.ts";
import { INPUT_VALIDATION_FAILED } from "#veryfront/errors/error-registry/general.ts";

const MAX_ESCAPE_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_ATTRIBUTE_ENTRIES = 128;
const MAX_ATTRIBUTE_NAME_BYTES = 256;
const MAX_ATTRIBUTE_VALUE_BYTES = 64 * 1024;
const MAX_TOTAL_ATTRIBUTE_BYTES = 1024 * 1024;
const MAX_INLINE_RAW_TEXT_BYTES = 4 * 1024 * 1024;

export function escapeHTML(input: unknown): string {
  const str = String(input ?? "");
  assertHTMLStringSize(str, "HTML escape input", MAX_ESCAPE_INPUT_BYTES);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const escapeHtml = escapeHTML;

const ATTRIBUTE_NAME_PATTERN = /^[A-Za-z_:][A-Za-z0-9_.:-]*$/;

export function buildAttributes(attrs: Readonly<Record<string, unknown>>): string {
  if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "HTML attributes must be an object" });
  }
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(attrs);
  } catch {
    throw INPUT_VALIDATION_FAILED.create({ detail: "HTML attributes cannot be inspected" });
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "HTML attributes must be a plain object" });
  }

  let keys: string[];
  try {
    keys = Object.keys(attrs);
  } catch {
    throw INPUT_VALIDATION_FAILED.create({ detail: "HTML attributes cannot be inspected" });
  }
  if (keys.length > MAX_ATTRIBUTE_ENTRIES) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "HTML attributes exceed the entry limit",
    });
  }

  const rendered: string[] = [];
  let totalBytes = 0;
  for (const key of keys) {
    const keyBytes = getUTF8ByteLength(key);
    if (
      !ATTRIBUTE_NAME_PATTERN.test(key) || keyBytes > MAX_ATTRIBUTE_NAME_BYTES
    ) {
      throw new TypeError("HTML attribute name is invalid");
    }

    let value: string;
    try {
      value = String(Reflect.get(attrs, key) ?? "");
    } catch {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "HTML attribute value cannot be inspected",
      });
    }
    const valueBytes = getUTF8ByteLength(value);
    if (valueBytes > MAX_ATTRIBUTE_VALUE_BYTES) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "HTML attribute value exceeds the size limit",
      });
    }
    totalBytes += keyBytes + valueBytes;
    if (totalBytes > MAX_TOTAL_ATTRIBUTE_BYTES) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "HTML attributes exceed the total size limit",
      });
    }
    rendered.push(`${key}="${escapeHTML(value)}"`);
  }
  return rendered.join(" ");
}

export function buildNonceAttribute(nonce?: string): string {
  if (nonce !== undefined) {
    assertBoundedHTMLText(nonce, "HTML nonce", MAX_HTML_NONCE_BYTES, { allowEmpty: true });
  }
  return nonce ? ` nonce="${escapeHTML(nonce)}"` : "";
}

export function escapeInlineScriptContent(content: string): string {
  const value = String(content ?? "");
  assertHTMLStringSize(value, "Inline script content", MAX_INLINE_RAW_TEXT_BYTES);
  return value.replace(/<\/script/gi, "<\\/script");
}

export function escapeInlineStyleContent(content: string): string {
  const value = String(content ?? "");
  assertHTMLStringSize(value, "Inline style content", MAX_INLINE_RAW_TEXT_BYTES);
  return value.replace(/<\/style/gi, "<\\/style");
}
