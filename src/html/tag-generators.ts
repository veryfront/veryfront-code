import type { HTMLMetadata } from "#veryfront/transforms/mdx/types.ts";
import { INPUT_VALIDATION_FAILED } from "#veryfront/errors/error-registry/general.ts";
import {
  buildAttributes,
  escapeHTML,
  escapeInlineScriptContent,
  escapeInlineStyleContent,
} from "./html-escape.ts";

const MAX_TAG_ATTRIBUTES = 32;
const MAX_VISITED_TAG_ATTRIBUTES = 128;
const MAX_TAG_ENTRIES = 100;

function inspectionError(detail: string): Error {
  return INPUT_VALIDATION_FAILED.create({ detail });
}

function isPlainRecord(
  value: unknown,
  detail: string,
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;

  let isArray: boolean;
  let prototype: object | null;
  try {
    isArray = Array.isArray(value);
    prototype = Object.getPrototypeOf(value);
  } catch {
    throw inspectionError(detail);
  }
  return !isArray && (prototype === Object.prototype || prototype === null);
}

function metadataRecord(metadata: unknown): Record<string, unknown> {
  if (!isPlainRecord(metadata, "HTML metadata cannot be inspected")) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "HTML metadata must be a plain object",
    });
  }
  return metadata;
}

function readDataProperty(
  record: Record<string, unknown>,
  key: string,
  detail: string,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Reflect.getOwnPropertyDescriptor(record, key);
  } catch {
    throw inspectionError(detail);
  }
  if (!descriptor || !descriptor.enumerable) return undefined;
  if (descriptor.get || descriptor.set || !("value" in descriptor)) {
    throw inspectionError(detail);
  }
  return descriptor.value;
}

function filterAttrs(
  obj: unknown,
  excludeKeys: readonly string[],
): Record<string, string> {
  if (!isPlainRecord(obj, "HTML tag attributes cannot be inspected")) return {};

  const attrs = Object.create(null) as Record<string, string>;
  let accepted = 0;
  let inspected = 0;
  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(obj);
  } catch {
    throw inspectionError("HTML tag attributes cannot be inspected");
  }

  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(obj, key);
    } catch {
      throw inspectionError("HTML tag attributes cannot be inspected");
    }
    if (!descriptor) throw inspectionError("HTML tag attributes cannot be inspected");
    if (!descriptor.enumerable) continue;

    inspected++;
    if (inspected > MAX_VISITED_TAG_ATTRIBUTES) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "HTML tag exceeds the attribute inspection limit",
      });
    }
    if (typeof key !== "string") {
      throw inspectionError("HTML tag attributes cannot be inspected");
    }
    if (excludeKeys.includes(key) || /^on/i.test(key)) continue;
    if (descriptor.get || descriptor.set || !("value" in descriptor)) {
      throw inspectionError("HTML tag attributes cannot be inspected");
    }
    if (typeof descriptor.value !== "string") continue;
    if (accepted >= MAX_TAG_ATTRIBUTES) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "HTML tag exceeds the attribute limit",
      });
    }

    Object.defineProperty(attrs, key, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    });
    accepted++;
  }
  return attrs;
}

function boundedTagEntries(value: unknown): unknown[] {
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    throw inspectionError("HTML metadata tag entries cannot be inspected");
  }
  if (!isArray) return [];

  let length: unknown;
  try {
    length = Reflect.getOwnPropertyDescriptor(value as object, "length")?.value;
  } catch {
    throw inspectionError("HTML metadata tag entries cannot be inspected");
  }
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    throw inspectionError("HTML metadata tag entries cannot be inspected");
  }
  if (length > MAX_TAG_ENTRIES) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "HTML metadata exceeds the tag entry limit",
    });
  }

  const entries: unknown[] = [];
  for (let index = 0; index < length; index++) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value as object, String(index));
    } catch {
      throw inspectionError("HTML metadata tag entry cannot be inspected");
    }
    if (
      !descriptor || !descriptor.enumerable || descriptor.get || descriptor.set ||
      !("value" in descriptor)
    ) {
      throw inspectionError("HTML metadata tag entry cannot be inspected");
    }
    entries.push(descriptor.value);
  }
  return entries;
}

function addNonceIfPresent(
  attrs: Record<string, string>,
  nonce?: string,
): Record<string, string> {
  if (!nonce) return attrs;
  return { ...attrs, nonce };
}

export function generateMetaTags(metadata: HTMLMetadata): string {
  const record = metadataRecord(metadata);
  const tags: string[] = ['<meta charset="UTF-8">'];

  const rawViewport = readDataProperty(record, "viewport", "HTML metadata cannot be inspected");
  const viewport = typeof rawViewport === "string"
    ? rawViewport
    : "width=device-width, initial-scale=1.0";
  tags.push(`<meta name="viewport" content="${escapeHTML(viewport)}">`);

  const description = readDataProperty(
    record,
    "description",
    "HTML metadata cannot be inspected",
  );
  if (typeof description === "string" && description) {
    tags.push(
      `<meta name="description" content="${escapeHTML(description)}">`,
    );
  }

  for (
    const meta of boundedTagEntries(
      readDataProperty(record, "meta", "HTML metadata cannot be inspected"),
    )
  ) {
    if (!isPlainRecord(meta, "HTML tag attributes cannot be inspected")) continue;
    tags.push(`<meta ${buildAttributes(filterAttrs(meta, []))}>`);
  }

  const themeColor = readDataProperty(
    record,
    "themeColor",
    "HTML metadata cannot be inspected",
  );
  if (typeof themeColor === "string" && themeColor) {
    tags.push(
      `<meta name="theme-color" content="${escapeHTML(themeColor)}">`,
    );
  }

  return tags.join("\n  ");
}

export function generateLinkTags(metadata: HTMLMetadata): string {
  const record = metadataRecord(metadata);
  const tags: string[] = [];

  for (
    const link of boundedTagEntries(
      readDataProperty(record, "links", "HTML metadata cannot be inspected"),
    )
  ) {
    if (!isPlainRecord(link, "HTML tag attributes cannot be inspected")) continue;
    const linkAttrs = filterAttrs(link, []);

    // Font preloads require crossorigin="anonymous" to match fetch behavior
    // Without this, the preloaded font won't be used and will be re-fetched
    if (
      linkAttrs.rel === "preload" &&
      linkAttrs.as === "font" &&
      !linkAttrs.crossorigin
    ) {
      linkAttrs.crossorigin = "anonymous";
    }

    tags.push(`<link ${buildAttributes(linkAttrs)}>`);
  }

  for (
    const icon of boundedTagEntries(
      readDataProperty(record, "icons", "HTML metadata cannot be inspected"),
    )
  ) {
    if (!isPlainRecord(icon, "HTML tag attributes cannot be inspected")) continue;
    const iconAttrs = filterAttrs(icon, []);
    const rel = iconAttrs.rel || "icon";
    delete iconAttrs.rel;
    tags.push(
      `<link ${buildAttributes({ rel, ...iconAttrs })}>`,
    );
  }

  return tags.join("\n  ");
}

export function generateScriptTags(
  metadata: HTMLMetadata,
  nonce?: string,
): string {
  const record = metadataRecord(metadata);
  const tags: string[] = [];

  for (
    const script of boundedTagEntries(
      readDataProperty(record, "scripts", "HTML metadata cannot be inspected"),
    )
  ) {
    if (!isPlainRecord(script, "HTML tag attributes cannot be inspected")) continue;
    const scriptAttrs = filterAttrs(script, []);
    const src = scriptAttrs.src;
    const content = scriptAttrs.content;
    if (src) {
      delete scriptAttrs.content;
      const attrs = addNonceIfPresent(scriptAttrs, nonce);
      tags.push(`<script ${buildAttributes(attrs)}></script>`);
      continue;
    }

    if (!content) continue;

    delete scriptAttrs.content;
    delete scriptAttrs.src;
    const attrs = addNonceIfPresent(
      scriptAttrs,
      nonce,
    );
    tags.push(
      `<script ${buildAttributes(attrs)}>${escapeInlineScriptContent(content)}</script>`,
    );
  }

  return tags.join("\n  ");
}

export function generateStyleTags(metadata: HTMLMetadata, nonce?: string): string {
  const record = metadataRecord(metadata);
  const tags: string[] = [];

  for (
    const style of boundedTagEntries(
      readDataProperty(record, "styles", "HTML metadata cannot be inspected"),
    )
  ) {
    if (!isPlainRecord(style, "HTML tag attributes cannot be inspected")) continue;
    const styleAttrs = filterAttrs(style, []);
    const href = styleAttrs.href;
    const content = styleAttrs.content;
    if (href) {
      delete styleAttrs.content;
      delete styleAttrs.rel;
      const attrs = addNonceIfPresent(styleAttrs, nonce);
      tags.push(`<link rel="stylesheet" ${buildAttributes(attrs)}>`);
      continue;
    }

    if (!content) continue;

    delete styleAttrs.content;
    delete styleAttrs.href;
    const attrs = addNonceIfPresent(
      styleAttrs,
      nonce,
    );
    tags.push(
      `<style ${buildAttributes(attrs)}>${escapeInlineStyleContent(content)}</style>`,
    );
  }

  return tags.join("\n  ");
}
