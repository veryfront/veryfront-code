import * as dntShim from "../../_dnt.shims.js";
export async function computeHash(content) {
    const data = new TextEncoder().encode(content);
    const hashBuffer = await dntShim.crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
/** @deprecated Use computeHash directly */
export const getContentHash = computeHash;
/** @deprecated Use computeHash directly */
export const computeContentHash = computeHash;
export function computeCodeHash(code) {
    return computeHash(`${code.code}${code.css ?? ""}${code.sourceMap ?? ""}`);
}
export function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash &= hash;
    }
    return Math.abs(hash);
}
/** Hash string to hex (base 16) - used for module filenames */
export function hashCodeHex(str) {
    return simpleHash(str).toString(16);
}
export async function shortHash(content) {
    const fullHash = await computeHash(content);
    return fullHash.slice(0, 8);
}
