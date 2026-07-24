import { createError, toError } from "#veryfront/errors";

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
  if (!allowedHosts?.length) return;

  const importRegex = /import\s+(?:[\w\s{},*]+\s+from\s+)?['"]https?:\/\/[^'"]+['"]/g;
  const dynamicImportRegex = /import\s*\(['"]https?:\/\/[^'"]+['"]\)/g;

  const matches = [...source.matchAll(importRegex), ...source.matchAll(dynamicImportRegex)];

  for (const match of matches) {
    const url = match[0].match(/https?:\/\/[^'"]+/)?.[0];
    if (!url) continue;

    let u: URL;
    try {
      u = new URL(url);
    } catch (_) {
      /* expected: URL may be malformed */
      continue;
    }

    if (isAllowedRemoteHost(u, allowedHosts)) continue;

    const remediation =
      `Add "${u.origin}" to security.remoteHosts in veryfront.config.(ts|js) or replace with an approved CDN (e.g., https://esm.sh).`;

    throw toError(
      createError({
        type: "api",
        message:
          `[API] handler build failed: Remote import blocked by allow-list: ${u.origin}. ${remediation}`,
      }),
    );
  }
}
