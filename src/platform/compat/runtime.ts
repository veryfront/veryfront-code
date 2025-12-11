export const isDeno = typeof Deno !== "undefined" && typeof Deno.version === "object";
export const isNode =
  typeof (globalThis as { process?: { versions?: { node?: string } } }).process !== "undefined" &&
  (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node !==
    undefined;
export const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
export const isCloudflare = typeof globalThis !== "undefined" && "caches" in globalThis &&
  "WebSocketPair" in globalThis;

export function isNodeRuntime(): boolean {
  // deno-lint-ignore no-explicit-any
  const _global = globalThis as any;
  // Check Deno.version to distinguish real Deno from the npm build shim
  const isRealDeno = typeof Deno !== "undefined" && typeof Deno.version === "object";
  return !isRealDeno && typeof _global.process !== "undefined" &&
    !!_global.process?.versions?.node;
}
