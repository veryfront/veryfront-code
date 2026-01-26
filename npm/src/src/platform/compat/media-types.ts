import mime from "mime-types";

export function contentType(path: string): string | undefined {
  const type = mime.lookup(path);
  if (!type) return undefined;

  const cs = mime.charset(type);
  if (!cs) return type;

  return `${type}; charset=${cs}`;
}

export function extension(type: string): string | undefined {
  return mime.extension(type) || undefined;
}

export function lookup(path: string): string | undefined {
  return mime.lookup(path) || undefined;
}

export function charset(type: string): string | undefined {
  return mime.charset(type) || undefined;
}
