/** Resolve the Studio origin that pairs with a Veryfront API base URL, or undefined when unknown. */
export function resolveStudioOrigin(apiBaseUrl: string, studioUrl?: string): string | undefined {
  if (studioUrl) return studioUrl;
  let hostname: string;
  try {
    hostname = new URL(apiBaseUrl).hostname;
  } catch {
    return undefined;
  }
  if (["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return "http://localhost:3000";
  if (hostname === "api.veryfront.com") return "https://veryfront.com";
  if (hostname === "api.veryfront.org") return "https://veryfront.org";
  return undefined;
}
