// Linux Actions parent stages this wrapper and one fixed synthetic fixture.
// Capture the actual engine before importing any project/package code.
import process from "node:process";
const runtime = typeof Bun !== "undefined" ? "bun" : typeof Deno !== "undefined" ? "deno" : "node";
const version = runtime === "bun"
  ? Bun.version
  : runtime === "deno"
  ? Deno.version.deno
  : process.versions.node;
const args = runtime === "deno" ? Deno.args : process.argv.slice(2);
if (
  args.length !== 1 ||
  !["native-header-package-probe.mjs", "native-body-package-probe.mjs"].includes(args[0])
) throw new TypeError("Unknown installed credential fixture");
console.log(
  JSON.stringify({ profile: "installed-runtime-credential-boundary-v2", runtime, version }),
);
await import(new URL(args[0], import.meta.url).href);
