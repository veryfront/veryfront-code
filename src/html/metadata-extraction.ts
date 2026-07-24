import { INPUT_VALIDATION_FAILED } from "#veryfront/errors/error-registry/general.ts";
import type { HTMLMetadata } from "#veryfront/transforms/mdx/types.ts";

const RESERVED_KEYS = new Set([
  "title",
  "description",
  "meta",
  "links",
  "icons",
  "scripts",
  "styles",
  "og",
  "twitter",
  "viewport",
  "themeColor",
  "lang",
  "bodyClass",
]);
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_SOCIAL_ENTRIES = 100;
const MAX_METADATA_ENTRIES = 100;
const MAX_METADATA_ATTRIBUTES = 32;
const MAX_INLINE_METADATA_CONTENT_BYTES = 1024 * 1024;
const MAX_STRUCTURED_METADATA_BYTES = 4 * 1024 * 1024;
const MAX_FRONTMATTER_ENTRIES = 1024;
const MAX_METADATA_TEXT_BYTES = 16 * 1024;
const textEncoder = new TextEncoder();

interface MetadataBudget {
  usedBytes: number;
}

function validationError(detail: string): Error {
  return INPUT_VALIDATION_FAILED.create({ detail });
}

function getUTF8ByteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function inspectEntries(
  value: Record<string, unknown>,
  label: string,
  maxEntries: number,
): Array<[string, unknown]> {
  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw validationError(`${label} cannot be inspected`);
  }

  const entries: Array<[string, unknown]> = [];
  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    } catch {
      throw validationError(`${label} cannot be inspected`);
    }
    if (!descriptor) throw validationError(`${label} cannot be inspected`);
    if (!descriptor.enumerable) continue;
    if (
      typeof key !== "string" || descriptor.get || descriptor.set ||
      !("value" in descriptor)
    ) {
      throw validationError(`${label} cannot be inspected`);
    }
    entries.push([key, descriptor.value]);
    if (entries.length > maxEntries) {
      throw validationError(`${label} exceeds the entry limit`);
    }
  }
  return entries;
}

function copySafeEntries(target: Record<string, unknown>, source: unknown): void {
  if (!isRecord(source)) return;
  for (const [key, value] of inspectEntries(source, "HTML frontmatter", MAX_FRONTMATTER_ENTRIES)) {
    if (UNSAFE_KEYS.has(key)) continue;
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
}

function stringValue(value: unknown, label: string, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  if (
    value.length > MAX_METADATA_TEXT_BYTES || getUTF8ByteLength(value) > MAX_METADATA_TEXT_BYTES
  ) {
    throw validationError(`HTML metadata ${label} exceeds the size limit`);
  }
  return value;
}

function copyStringAttributes(
  value: unknown,
  budget: MetadataBudget,
  maxContentBytes: number,
): Record<string, string> | null {
  if (!isRecord(value)) return null;

  const result: Record<string, string> = {};
  for (
    const [key, attributeValue] of inspectEntries(
      value,
      "HTML metadata entry",
      MAX_METADATA_ATTRIBUTES,
    )
  ) {
    if (UNSAFE_KEYS.has(key) || typeof attributeValue !== "string") continue;

    const maxBytes = key === "content" ? maxContentBytes : MAX_METADATA_TEXT_BYTES;
    const valueBytes = getUTF8ByteLength(attributeValue);
    if (attributeValue.length > maxBytes || valueBytes > maxBytes) {
      throw validationError(`HTML metadata attribute ${key} exceeds the size limit`);
    }
    if (budget.usedBytes > MAX_STRUCTURED_METADATA_BYTES - valueBytes) {
      throw validationError("HTML metadata exceeds the aggregate byte budget");
    }

    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: attributeValue,
      writable: true,
    });
    budget.usedBytes += valueBytes;
  }
  return result;
}

function copyMetadataEntries<T>(
  value: unknown,
  isValid: (entry: Record<string, string>) => boolean,
  budget: MetadataBudget,
  maxContentBytes = MAX_METADATA_TEXT_BYTES,
): T[] {
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    throw validationError("HTML metadata cannot be inspected");
  }
  if (!isArray) return [];

  let length: unknown;
  try {
    length = Reflect.getOwnPropertyDescriptor(value as object, "length")?.value;
  } catch {
    throw validationError("HTML metadata cannot be inspected");
  }
  if (!Number.isSafeInteger(length) || (length as number) < 0) {
    throw validationError("HTML metadata cannot be inspected");
  }
  if ((length as number) > MAX_METADATA_ENTRIES) {
    throw validationError("HTML metadata exceeds the entry limit");
  }

  const result: T[] = [];
  for (let index = 0; index < (length as number); index++) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value as object, String(index));
    } catch {
      throw validationError("HTML metadata entry cannot be inspected");
    }
    if (
      !descriptor || !descriptor.enumerable || descriptor.get || descriptor.set ||
      !("value" in descriptor)
    ) {
      throw validationError("HTML metadata entry cannot be inspected");
    }

    const entry = copyStringAttributes(descriptor.value, budget, maxContentBytes);
    if (entry && isValid(entry)) result.push(entry as T);
  }
  return result;
}

function appendSocialMetadata(
  metadata: HTMLMetadata,
  prefix: "og" | "twitter",
  value: unknown,
  budget: MetadataBudget,
): void {
  if (!isRecord(value) || !metadata.meta) return;

  let count = 0;
  for (
    const [key, rawContent] of inspectEntries(
      value,
      `HTML ${prefix} metadata`,
      MAX_SOCIAL_ENTRIES,
    )
  ) {
    if (!/^[A-Za-z0-9:_-]{1,64}$/.test(key)) continue;
    if (
      typeof rawContent !== "string" &&
      typeof rawContent !== "boolean" &&
      !(typeof rawContent === "number" && Number.isFinite(rawContent))
    ) {
      continue;
    }
    if (count >= MAX_SOCIAL_ENTRIES || metadata.meta.length >= MAX_METADATA_ENTRIES) {
      throw validationError("HTML social metadata exceeds the entry limit");
    }

    const content = String(rawContent);
    const contentBytes = getUTF8ByteLength(content);
    if (content.length > 4096 || contentBytes > 4096) {
      throw validationError("HTML social metadata content exceeds the size limit");
    }
    if (budget.usedBytes > MAX_STRUCTURED_METADATA_BYTES - contentBytes) {
      throw validationError("HTML metadata exceeds the aggregate byte budget");
    }

    metadata.meta.push(
      prefix === "og" ? { property: `og:${key}`, content } : { name: `twitter:${key}`, content },
    );
    budget.usedBytes += contentBytes;
    count++;
  }
}

/**
 * Builds independent, bounded HTML metadata from page and layout frontmatter.
 *
 * Own data descriptors are inspected without invoking accessors. Structured
 * arrays and records are copied before OpenGraph or Twitter tags are appended,
 * so repeated calls cannot mutate or alias caller-owned metadata.
 */
export function extractHTMLMetadata(
  pageFrontmatter: unknown,
  layoutFrontmatter?: unknown,
): HTMLMetadata {
  const budget: MetadataBudget = { usedBytes: 0 };
  const merged: Record<string, unknown> = {};
  copySafeEntries(merged, layoutFrontmatter);
  copySafeEntries(merged, pageFrontmatter);
  copySafeEntries(merged, merged.metadata);

  const metadata: HTMLMetadata = {
    title: stringValue(merged.title, "title") || "Veryfront App",
    description: stringValue(merged.description, "description"),
    viewport: typeof merged.viewport === "string"
      ? stringValue(merged.viewport, "viewport")
      : undefined,
    themeColor: typeof merged.themeColor === "string"
      ? stringValue(merged.themeColor, "theme color")
      : undefined,
    meta: copyMetadataEntries<NonNullable<HTMLMetadata["meta"]>[number]>(
      merged.meta,
      (entry) =>
        typeof entry.content === "string" &&
        (typeof entry.name === "string" || typeof entry.property === "string"),
      budget,
    ),
    links: copyMetadataEntries<NonNullable<HTMLMetadata["links"]>[number]>(
      merged.links,
      (entry) => typeof entry.rel === "string" && typeof entry.href === "string",
      budget,
    ),
    icons: copyMetadataEntries<NonNullable<HTMLMetadata["icons"]>[number]>(
      merged.icons,
      (entry) => typeof entry.href === "string",
      budget,
    ),
    scripts: copyMetadataEntries<NonNullable<HTMLMetadata["scripts"]>[number]>(
      merged.scripts,
      (entry) => typeof entry.src === "string" || typeof entry.content === "string",
      budget,
      MAX_INLINE_METADATA_CONTENT_BYTES,
    ),
    styles: copyMetadataEntries<NonNullable<HTMLMetadata["styles"]>[number]>(
      merged.styles,
      (entry) => typeof entry.href === "string" || typeof entry.content === "string",
      budget,
      MAX_INLINE_METADATA_CONTENT_BYTES,
    ),
  };

  appendSocialMetadata(metadata, "og", merged.og, budget);
  appendSocialMetadata(metadata, "twitter", merged.twitter, budget);

  if (typeof merged.lang === "string") metadata.lang = stringValue(merged.lang, "language");
  if (typeof merged.bodyClass === "string") {
    metadata.bodyClass = stringValue(merged.bodyClass, "body class");
  }

  for (const [key, value] of Object.entries(merged)) {
    if (RESERVED_KEYS.has(key) || UNSAFE_KEYS.has(key)) continue;
    metadata[key] = value;
  }

  return metadata;
}
