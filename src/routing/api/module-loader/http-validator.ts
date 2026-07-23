import { SECURITY_VIOLATION } from "#veryfront/errors";
import { findModuleSpecifierSpans } from "#veryfront/modules/loader-shared/import-specifiers.ts";

export function isAllowedRemoteHost(url: URL, allowedHosts: string[]): boolean {
  return allowedHosts.some((host) => {
    try {
      return new URL(host).origin === url.origin;
    } catch (_) {
      return false;
    }
  });
}

export function validateHTTPImports(source: string, allowedHosts: string[]): void {
  const remoteSpecifiers = findModuleSpecifierSpans(source)
    .map(({ specifier }) => specifier)
    .filter((specifier) => /^https?:\/\//i.test(specifier));

  for (const specifier of remoteSpecifiers) {
    const u = new URL(specifier);

    if (isAllowedRemoteHost(u, allowedHosts)) continue;

    const remediation =
      `Add "${u.origin}" to security.remoteHosts in veryfront.config.(ts|js) or replace with an approved CDN (e.g., https://esm.sh).`;

    throw SECURITY_VIOLATION.create({
      message:
        `[API] handler build failed: Remote import blocked by allow-list: ${u.origin}. ${remediation}`,
    });
  }
}
