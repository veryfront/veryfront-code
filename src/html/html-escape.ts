export function escapeHTML(str: string): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const escapeHtml = escapeHTML;

export function buildAttributes(attrs: Readonly<Record<string, unknown>>): string {
  if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "HTML attributes must be an object" });
  }

  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(attrs);
    keys = Reflect.ownKeys(attrs);
  } catch {
    throw INPUT_VALIDATION_FAILED.create({ detail: "HTML attributes cannot be inspected" });
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "HTML attributes must be a plain object" });
  }

  const rendered: string[] = [];
  let totalBytes = 0;
  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(attrs, key);
    } catch {
      throw INPUT_VALIDATION_FAILED.create({ detail: "HTML attributes cannot be inspected" });
    }
    if (!descriptor) {
      throw INPUT_VALIDATION_FAILED.create({ detail: "HTML attributes cannot be inspected" });
    }
    if (!descriptor.enumerable) continue;
    if (
      typeof key !== "string" || descriptor.get || descriptor.set ||
      !("value" in descriptor)
    ) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "HTML attribute value cannot be inspected",
      });
    }
    if (rendered.length >= MAX_ATTRIBUTE_ENTRIES) {
      throw INPUT_VALIDATION_FAILED.create({ detail: "HTML attributes exceed the entry limit" });
    }

    const keyBytes = textEncoder.encode(key).byteLength;
    if (!ATTRIBUTE_NAME_PATTERN.test(key) || keyBytes > MAX_ATTRIBUTE_NAME_BYTES) {
      throw new TypeError("HTML attribute name is invalid");
    }

    let value: string;
    try {
      value = String(descriptor.value ?? "");
    } catch {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "HTML attribute value cannot be inspected",
      });
    }
    const valueBytes = textEncoder.encode(value).byteLength;
    if (value.length > MAX_ATTRIBUTE_VALUE_BYTES || valueBytes > MAX_ATTRIBUTE_VALUE_BYTES) {
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
  return nonce ? ` nonce="${escapeHTML(nonce)}"` : "";
}

export function escapeInlineScriptContent(content: string): string {
  return String(content ?? "").replace(/<\/script/gi, "<\\/script");
}

export function escapeInlineStyleContent(content: string): string {
  return String(content ?? "").replace(/<\/style/gi, "<\\/style");
}
import { INPUT_VALIDATION_FAILED } from "#veryfront/errors/error-registry/general.ts";

const ATTRIBUTE_NAME_PATTERN = /^[A-Za-z_:][A-Za-z0-9_.:-]*$/;
const MAX_ATTRIBUTE_ENTRIES = 128;
const MAX_ATTRIBUTE_NAME_BYTES = 256;
const MAX_ATTRIBUTE_VALUE_BYTES = 64 * 1024;
const MAX_TOTAL_ATTRIBUTE_BYTES = 1024 * 1024;
const textEncoder = new TextEncoder();
