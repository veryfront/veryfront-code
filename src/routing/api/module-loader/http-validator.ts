import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

export function validateHTTPImports(source: string, allowedHosts: string[]): void {
  if (!allowedHosts?.length) return;

  const importRegex = /import\s+(?:[\w\s{},*]+\s+from\s+)?['"]https?:\/\/[^'"]+['"]/g;
  const dynamicImportRegex = /import\s*\(['"]https?:\/\/[^'"]+['"]\)/g;

  const matches = [...source.matchAll(importRegex), ...source.matchAll(dynamicImportRegex)];

  for (const match of matches) {
    const url = match[0].match(/https?:\/\/[^'"]+/)?.[0];
    if (!url) continue;

    let hostUrl: string;
    try {
      const u = new URL(url);
      hostUrl = `${u.protocol}//${u.host}`;
    } catch (_) {
      /* expected: URL may be malformed */
      continue;
    }

    const isAllowed = allowedHosts.some((h) => hostUrl.startsWith(h));
    if (isAllowed) continue;

    const remediation =
      `Add "${hostUrl}" to security.remoteHosts in veryfront.config.(ts|js) or replace with an approved CDN (e.g., https://esm.sh).`;

    throw toError(
      createError({
        type: "api",
        message:
          `[API] handler build failed: Remote import blocked by allow-list: ${hostUrl}. ${remediation}`,
      }),
    );
  }
}
