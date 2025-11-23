export const isDeno = typeof Deno !== "undefined";
export const isNode =
  typeof (globalThis as { process?: { versions?: { node?: string } } }).process !== "undefined" &&
  (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node !==
    undefined;
export const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
export const isCloudflare = typeof globalThis !== "undefined" && "caches" in globalThis &&
  "WebSocketPair" in globalThis;
