import {
  charset as mimeCharset,
  extension as mimeExtension,
  lookup as mimeLookup,
} from "#veryfront/utils/mime-types.ts";

const MEDIA_TYPE_TOP_LEVELS = new Set([
  "application",
  "audio",
  "font",
  "haptics",
  "image",
  "message",
  "model",
  "multipart",
  "text",
  "video",
]);

function normalizeMediaType(type: string): string {
  return type.split(";", 1)[0]!.trim().toLowerCase();
}

function isMediaType(value: string): boolean {
  const essence = normalizeMediaType(value);
  const separator = essence.indexOf("/");
  if (separator <= 0 || separator !== essence.lastIndexOf("/")) return false;

  const topLevel = essence.slice(0, separator);
  const subtype = essence.slice(separator + 1);
  return MEDIA_TYPE_TOP_LEVELS.has(topLevel) && subtype.length > 0 && !/\s/.test(subtype);
}

export function contentType(pathOrType: string): string | undefined {
  const input = pathOrType.trim();
  if (!input) return undefined;

  const type = mimeLookup(input) || (isMediaType(input) ? input : undefined);
  if (!type) return undefined;

  if (/;\s*charset\s*=/i.test(type)) return type;

  const cs = mimeCharset(normalizeMediaType(type));
  if (!cs) return type;

  return `${type}; charset=${cs}`;
}

export function extension(type: string): string | undefined {
  return mimeExtension(normalizeMediaType(type)) || undefined;
}

export function lookup(path: string): string | undefined {
  return mimeLookup(path) || undefined;
}

export function charset(type: string): string | undefined {
  return mimeCharset(normalizeMediaType(type)) || undefined;
}
