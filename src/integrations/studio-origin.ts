const NativeURL = URL;
const urlHostname = Object.getOwnPropertyDescriptor(NativeURL.prototype, "hostname")!.get!;
const apply = Reflect.apply;

/** Resolve the Studio origin that pairs with a Veryfront API base URL, or undefined when unknown. */
export function resolveStudioOrigin(apiBaseUrl: string, studioUrl?: string): string | undefined {
  if (studioUrl) return studioUrl;
  let hostname: string;
  try {
    hostname = apply(urlHostname, new NativeURL(apiBaseUrl), []) as string;
  } catch {
    return undefined;
  }
  // Compared directly: agent code may replace the built-ins a lookup table would dispatch through.
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
    return "http://localhost:3000";
  }
  if (hostname === "api.veryfront.com") return "https://veryfront.com";
  if (hostname === "api.veryfront.org") return "https://veryfront.org";
  return undefined;
}
