import type { HTMLMetadata } from "#veryfront/transforms/mdx/types.ts";
import {
  buildAttributes,
  escapeHTML,
  escapeInlineScriptContent,
  escapeInlineStyleContent,
} from "./html-escape.ts";
import { INPUT_VALIDATION_FAILED } from "#veryfront/errors/error-registry/general.ts";
import { snapshotPlainDataRecord } from "./json-snapshot.ts";

const MAX_TAG_ATTRIBUTES = 32;
const MAX_VISITED_TAG_ATTRIBUTES = 128;

function filterAttrs(
  obj: unknown,
  excludeKeys: string[],
): Record<string, string> {
  if (!isAttributeObject(obj)) return {};
  const attrs: Record<string, string> = {};
  let accepted = 0;
  let inspected = 0;
  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(obj);
  } catch {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "HTML tag attributes cannot be inspected",
    });
  }

  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(obj, key);
    } catch {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "HTML tag attributes cannot be inspected",
      });
    }
    if (!descriptor) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "HTML tag attributes cannot be inspected",
      });
    }
    if (!descriptor.enumerable) continue;
    inspected++;
    if (inspected > MAX_VISITED_TAG_ATTRIBUTES) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "HTML tag exceeds the attribute inspection limit",
      });
    }
    if (
      typeof key !== "string" || descriptor.get || descriptor.set ||
      !("value" in descriptor)
    ) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "HTML tag attributes cannot be inspected",
      });
    }
    const value = descriptor.value;
    if (excludeKeys.includes(key) || /^on/i.test(key) || typeof value !== "string") continue;
    if (accepted >= MAX_TAG_ATTRIBUTES) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "HTML tag exceeds the attribute limit",
      });
    }
    attrs[key] = value;
    accepted++;
  }
  return attrs;
}

const MAX_TAG_ENTRIES = 100;

function isAttributeObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "HTML tag attributes cannot be inspected",
    });
  }
}

function boundedTagEntries(value: unknown): unknown[] {
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "HTML metadata tag entries cannot be inspected",
    });
  }
  if (!isArray) return [];
  let length: unknown;
  try {
    length = Reflect.getOwnPropertyDescriptor(value as object, "length")?.value;
  } catch {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "HTML metadata tag entries cannot be inspected",
    });
  }
  if (!Number.isSafeInteger(length) || (length as number) < 0) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "HTML metadata tag entries cannot be inspected",
    });
  }
  if ((length as number) > MAX_TAG_ENTRIES) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "HTML metadata exceeds the tag entry limit",
    });
  }
  const entries: unknown[] = new Array(length as number);
  for (let index = 0; index < (length as number); index++) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value as object, String(index));
    } catch {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "HTML metadata tag entry cannot be inspected",
      });
    }
    if (!descriptor || descriptor.get || descriptor.set || !("value" in descriptor)) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "HTML metadata tag entry cannot be inspected",
      });
    }
    entries[index] = descriptor.value;
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
  metadata = snapshotPlainDataRecord(metadata, "HTML metadata") as HTMLMetadata;
  const tags: string[] = ['<meta charset="UTF-8">'];

  const viewport = typeof metadata.viewport === "string"
    ? metadata.viewport
    : "width=device-width, initial-scale=1.0";
  tags.push(`<meta name="viewport" content="${escapeHTML(viewport)}">`);

  if (typeof metadata.description === "string" && metadata.description) {
    tags.push(
      `<meta name="description" content="${escapeHTML(metadata.description)}">`,
    );
  }

  for (const meta of boundedTagEntries(metadata.meta)) {
    if (!isAttributeObject(meta)) continue;
    tags.push(`<meta ${buildAttributes(filterAttrs(meta, []))}>`);
  }

  if (typeof metadata.themeColor === "string" && metadata.themeColor) {
    tags.push(
      `<meta name="theme-color" content="${escapeHTML(metadata.themeColor)}">`,
    );
  }

  return tags.join("\n  ");
}

export function generateLinkTags(metadata: HTMLMetadata): string {
  metadata = snapshotPlainDataRecord(metadata, "HTML metadata") as HTMLMetadata;
  const tags: string[] = [];

  for (const link of boundedTagEntries(metadata.links)) {
    if (!isAttributeObject(link)) continue;
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

  for (const icon of boundedTagEntries(metadata.icons)) {
    if (!isAttributeObject(icon)) continue;
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
  metadata = snapshotPlainDataRecord(metadata, "HTML metadata") as HTMLMetadata;
  const tags: string[] = [];

  for (const script of boundedTagEntries(metadata.scripts)) {
    if (!isAttributeObject(script)) continue;
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
  metadata = snapshotPlainDataRecord(metadata, "HTML metadata") as HTMLMetadata;
  const tags: string[] = [];

  for (const style of boundedTagEntries(metadata.styles)) {
    if (!isAttributeObject(style)) continue;
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
