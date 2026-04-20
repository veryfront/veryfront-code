import {
  charset as mimeCharset,
  extension as mimeExtension,
  lookup as mimeLookup,
} from "#veryfront/utils/mime-types.ts";

export function contentType(path: string): string | undefined {
  const type = mimeLookup(path);
  if (!type) return undefined;

  const cs = mimeCharset(type);
  if (!cs) return type;

  return `${type}; charset=${cs}`;
}

export function extension(type: string): string | undefined {
  return mimeExtension(type) || undefined;
}

export function lookup(path: string): string | undefined {
  return mimeLookup(path) || undefined;
}

export function charset(type: string): string | undefined {
  return mimeCharset(type) || undefined;
}
