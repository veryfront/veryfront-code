import { INPUT_VALIDATION_FAILED } from "#veryfront/errors/error-registry/general.ts";
import type { HTMLMetadata } from "#veryfront/transforms/mdx/types.ts";
import {
  buildAttributes,
  escapeInlineScriptContent,
  escapeInlineStyleContent,
} from "./html-escape.ts";
import {
  assertManagedHeadDescriptorBudget,
  descriptorFromManagedHeadRecord,
  HEAD_SHELL_PROVENANCE_ATTRIBUTE,
  isHeadFrameworkAttribute,
  type ManagedHeadDescriptor,
} from "./managed-head-protocol.ts";

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
    if (
      excludeKeys.includes(key) ||
      /^on/i.test(key) ||
      isHeadFrameworkAttribute(key)
    ) {
      continue;
    }
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

type StructuredHeadTagName = "title" | "meta" | "link" | "script" | "style";

interface StructuredHeadTag {
  readonly tagName: StructuredHeadTagName;
  readonly attributes: Record<string, string>;
  readonly content?: string;
  readonly managed: boolean;
  readonly nonceEligible?: boolean;
}

const STRUCTURED_HEAD_CONTENT_PROPERTY = "__veryfront_structured_head_content";

function declaresDocumentEncoding(attributes: Readonly<Record<string, string>>): boolean {
  for (const [name, value] of Object.entries(attributes)) {
    const normalizedName = name.toLowerCase();
    if (normalizedName === "charset") return true;
    if (
      normalizedName === "http-equiv" &&
      value.trim().toLowerCase() === "content-type"
    ) {
      return true;
    }
  }
  return false;
}

export function generateMetaTags(metadata: HTMLMetadata): string {
  const record = metadataRecord(metadata);
  return serializeStructuredHeadTags(buildMetaTagSpecs(record));
}

function buildMetaTagSpecs(record: Record<string, unknown>): StructuredHeadTag[] {
  const tags: StructuredHeadTag[] = [{
    tagName: "meta",
    attributes: { charset: "UTF-8" },
    managed: false,
  }];

  const rawViewport = readDataProperty(record, "viewport", "HTML metadata cannot be inspected");
  const viewport = typeof rawViewport === "string"
    ? rawViewport
    : "width=device-width, initial-scale=1.0";
  tags.push(
    {
      tagName: "meta",
      attributes: { name: "viewport", content: viewport },
      managed: true,
    },
  );

  const description = readDataProperty(
    record,
    "description",
    "HTML metadata cannot be inspected",
  );
  if (typeof description === "string" && description) {
    tags.push(
      {
        tagName: "meta",
        attributes: { name: "description", content: description },
        managed: true,
      },
    );
  }

  for (
    const meta of boundedTagEntries(
      readDataProperty(record, "meta", "HTML metadata cannot be inspected"),
    )
  ) {
    if (!isPlainRecord(meta, "HTML tag attributes cannot be inspected")) continue;
    const attributes = filterAttrs(meta, []);
    if (declaresDocumentEncoding(attributes) || Object.keys(attributes).length === 0) continue;
    tags.push({ tagName: "meta", attributes, managed: true });
  }

  const themeColor = readDataProperty(
    record,
    "themeColor",
    "HTML metadata cannot be inspected",
  );
  if (typeof themeColor === "string" && themeColor) {
    tags.push(
      {
        tagName: "meta",
        attributes: { name: "theme-color", content: themeColor },
        managed: true,
      },
    );
  }

  return tags;
}

export function generateLinkTags(metadata: HTMLMetadata): string {
  const record = metadataRecord(metadata);
  return serializeStructuredHeadTags(buildLinkTagSpecs(record));
}

function buildLinkTagSpecs(record: Record<string, unknown>): StructuredHeadTag[] {
  const tags: StructuredHeadTag[] = [];

  for (
    const link of boundedTagEntries(
      readDataProperty(record, "links", "HTML metadata cannot be inspected"),
    )
  ) {
    if (!isPlainRecord(link, "HTML tag attributes cannot be inspected")) continue;
    const linkAttrs = filterAttrs(link, []);

    if (
      linkAttrs.rel === "preload" &&
      linkAttrs.as === "font" &&
      !linkAttrs.crossorigin
    ) {
      linkAttrs.crossorigin = "anonymous";
    }

    if (Object.keys(linkAttrs).length > 0) {
      tags.push({ tagName: "link", attributes: linkAttrs, managed: true });
    }
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
      { tagName: "link", attributes: { rel, ...iconAttrs }, managed: true },
    );
  }

  return tags;
}

export function generateScriptTags(
  metadata: HTMLMetadata,
  nonce?: string,
): string {
  const record = metadataRecord(metadata);
  return serializeStructuredHeadTags(buildScriptTagSpecs(record), nonce);
}

function buildScriptTagSpecs(record: Record<string, unknown>): StructuredHeadTag[] {
  const tags: StructuredHeadTag[] = [];

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
      tags.push({
        tagName: "script",
        attributes: scriptAttrs,
        managed: true,
        nonceEligible: true,
      });
      continue;
    }

    if (!content) continue;

    delete scriptAttrs.content;
    delete scriptAttrs.src;
    tags.push(
      {
        tagName: "script",
        attributes: scriptAttrs,
        content,
        managed: true,
        nonceEligible: true,
      },
    );
  }

  return tags;
}

export function generateStyleTags(metadata: HTMLMetadata, nonce?: string): string {
  const record = metadataRecord(metadata);
  return serializeStructuredHeadTags(buildStyleTagSpecs(record), nonce);
}

function buildStyleTagSpecs(record: Record<string, unknown>): StructuredHeadTag[] {
  const tags: StructuredHeadTag[] = [];

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
      tags.push({
        tagName: "link",
        attributes: { rel: "stylesheet", ...styleAttrs },
        managed: true,
        nonceEligible: true,
      });
      continue;
    }

    if (!content) continue;

    delete styleAttrs.content;
    delete styleAttrs.href;
    tags.push(
      {
        tagName: "style",
        attributes: styleAttrs,
        content,
        managed: true,
        nonceEligible: true,
      },
    );
  }

  return tags;
}

function descriptorFromStructuredHeadTag(tag: StructuredHeadTag): ManagedHeadDescriptor | null {
  if (!tag.managed) return null;
  const record = Object.assign(Object.create(null), tag.attributes) as Record<string, unknown>;
  if (tag.content !== undefined) record[STRUCTURED_HEAD_CONTENT_PROPERTY] = tag.content;
  const supportsText = tag.tagName === "title" || tag.tagName === "script" ||
    tag.tagName === "style";
  return descriptorFromManagedHeadRecord(tag.tagName, record, {
    ...(supportsText && { contentProperty: STRUCTURED_HEAD_CONTENT_PROPERTY }),
  });
}

function descriptorsFromStructuredHeadTags(
  tags: readonly StructuredHeadTag[],
): ManagedHeadDescriptor[] {
  const descriptors = tags.flatMap((tag) => {
    const descriptor = descriptorFromStructuredHeadTag(tag);
    if (!tag.managed) return [];
    if (!descriptor) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "HTML metadata failed managed-head validation",
      });
    }
    return [descriptor];
  });
  assertManagedHeadDescriptorBudget(descriptors);
  return descriptors;
}

function serializeStructuredHeadTags(
  tags: readonly StructuredHeadTag[],
  nonce?: string,
): string {
  descriptorsFromStructuredHeadTags(tags);
  return tags.map((tag) => {
    const attributes = {
      ...tag.attributes,
      ...(tag.managed ? { [HEAD_SHELL_PROVENANCE_ATTRIBUTE]: "true" } : {}),
      ...(tag.nonceEligible && nonce ? { nonce } : {}),
    };
    const serializedAttributes = buildAttributes(attributes);
    if (tag.tagName === "meta" || tag.tagName === "link") {
      return `<${tag.tagName} ${serializedAttributes}>`;
    }
    const content = tag.tagName === "script"
      ? escapeInlineScriptContent(tag.content ?? "")
      : tag.tagName === "style"
      ? escapeInlineStyleContent(tag.content ?? "")
      : tag.content ?? "";
    return `<${tag.tagName} ${serializedAttributes}>${content}</${tag.tagName}>`;
  }).join("\n  ");
}

export function buildStructuredManagedHeadDescriptors(
  metadata: HTMLMetadata,
  effectiveTitle: string,
): ManagedHeadDescriptor[] {
  const record = metadataRecord(metadata);
  const tags: StructuredHeadTag[] = [
    { tagName: "title", attributes: {}, content: effectiveTitle, managed: true },
    ...buildMetaTagSpecs(record),
    ...buildLinkTagSpecs(record),
    ...buildStyleTagSpecs(record),
    ...buildScriptTagSpecs(record),
  ];
  return descriptorsFromStructuredHeadTags(tags);
}
