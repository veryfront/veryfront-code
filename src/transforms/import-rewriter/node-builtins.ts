/**
 * Canonical bare Node.js builtin specifiers supported by the platform.
 *
 * Keep this list independent of the host runtime: Deno's `node:module`
 * compatibility layer intentionally differs from Node for a few names.
 * Prefix-only modules such as `node:test`, `node:sqlite`, and `node:sea` do
 * not appear here because their bare forms are ordinary npm package names.
 */
export const NODE_BUILTINS = [
  "_http_agent",
  "_http_client",
  "_http_common",
  "_http_incoming",
  "_http_outgoing",
  "_http_server",
  "_stream_duplex",
  "_stream_passthrough",
  "_stream_readable",
  "_stream_transform",
  "_stream_wrap",
  "_stream_writable",
  "_tls_common",
  "_tls_wrap",
  "assert",
  "assert/strict",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "dns/promises",
  "domain",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "inspector/promises",
  "module",
  "net",
  "os",
  "path",
  "path/posix",
  "path/win32",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "readline/promises",
  "repl",
  "stream",
  "stream/consumers",
  "stream/promises",
  "stream/web",
  "string_decoder",
  "sys",
  "timers",
  "timers/promises",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "util/types",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
] as const;

const NODE_BUILTIN_SET: ReadonlySet<string> = new Set(NODE_BUILTINS);

export function isNodeBuiltinSpecifier(specifier: string): boolean {
  return specifier.startsWith("node:") || NODE_BUILTIN_SET.has(specifier);
}
