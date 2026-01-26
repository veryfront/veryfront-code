/**
 * Proxy environment utilities.
 */
const VALID_PROXY_ENVIRONMENTS = ["preview", "production"];
/** Validate and parse proxy environment header */
export function parseProxyEnvironment(value) {
    if (!value)
        return undefined;
    if (VALID_PROXY_ENVIRONMENTS.includes(value)) {
        return value;
    }
    return undefined;
}
