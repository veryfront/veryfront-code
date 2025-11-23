import { createError, toError } from "../../../core/errors/veryfront-error.ts";

export function validateHTTPImports(source: string, allowedHosts: string[]): void {
  const importRegex = /import\s+(?:[\w\s{},*]+\s+from\s+)?['"]https?:\/\/[^'"]+['"]/g;
  const dynamicImportRegex = /import\s*\(['"]https?:\/\/[^'"]+['"]\)/g;

  const matches = [
    ...source.matchAll(importRegex),
    ...source.matchAll(dynamicImportRegex),
  ];

  for (const match of matches) {
    const urlMatch = match[0].match(/https?:\/\/[^'"]+/);
    if (!urlMatch) continue;

    const fullUrl = urlMatch[0];
    try {
      const u = new URL(fullUrl);
      const hostUrl = `${u.protocol}//${u.host}`;

      if (allowedHosts && allowedHosts.length > 0) {
        const isAllowed = allowedHosts.some((h) => hostUrl.startsWith(h));
        if (!isAllowed) {
          const remediation =
            `Add "${hostUrl}" to security.remoteHosts in veryfront.config.(ts|js) or replace with an approved CDN (e.g., https://esm.sh).`;
          throw toError(createError({
            type: "api",
            message:
              `[API] handler build failed: Remote import blocked by allow-list: ${hostUrl}. ${remediation}`,
          }));
        }
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("Remote import blocked")) {
        throw e;
      }
    }
  }
}
