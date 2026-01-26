import mime from "mime-types";
export function contentType(path) {
    const type = mime.lookup(path);
    if (!type)
        return undefined;
    const cs = mime.charset(type);
    if (!cs)
        return type;
    return `${type}; charset=${cs}`;
}
export function extension(type) {
    return mime.extension(type) || undefined;
}
export function lookup(path) {
    return mime.lookup(path) || undefined;
}
export function charset(type) {
    return mime.charset(type) || undefined;
}
