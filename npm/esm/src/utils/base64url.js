/***********************
 * Base64url encoding utilities
 ***********************/
function toBase64Url(b64) {
    return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
export function base64urlEncode(input) {
    return toBase64Url(btoa(input));
}
export function base64urlEncodeBytes(bytes) {
    return toBase64Url(btoa(String.fromCharCode(...bytes)));
}
