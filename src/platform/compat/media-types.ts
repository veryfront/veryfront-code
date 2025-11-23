import mime from "mime-types";

export function contentType(path: string) {
  const type = mime.lookup(path);
  if (!type) return undefined;

  const cs = mime.charset(type);
  if (typeof cs === "string") return `${type}; charset=${cs}`;
  return type;
}

export function extension(type: string) {
  const ext = mime.extension(type);
  return typeof ext === "string" ? ext : undefined;
}

export function lookup(path: string) {
  const type = mime.lookup(path);
  return typeof type === "string" ? type : undefined;
}

export function charset(type: string) {
  const cs = mime.charset(type);
  return typeof cs === "string" ? cs : undefined;
}
