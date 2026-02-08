/**
 * Server URL resolution for dedicated veryfront-server instances.
 *
 * Validates server hostnames before building URLs to prevent SSRF.
 * Must be a bare hostname or hostname:port -- no protocol, path, user-info, or special chars.
 */

export const VALID_HOSTNAME_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;

export function resolveServerBaseUrl(
  serverHostname: string | undefined,
  fallbackUrl: string,
  onInvalid?: (hostname: string) => void,
): string {
  if (serverHostname && VALID_HOSTNAME_RE.test(serverHostname)) {
    return `http://${serverHostname}`;
  }
  if (serverHostname) {
    onInvalid?.(serverHostname);
  }
  return fallbackUrl;
}
