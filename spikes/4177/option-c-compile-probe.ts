// Option C probe: what can a deno-compiled binary load from a project on disk?
import { createRequire } from "node:module";
const projectDir = Deno.args[0];
const results: Record<string, string> = {};
async function attempt(name: string, fn: () => unknown) {
  try {
    const v = await fn();
    results[name] = "ok " + JSON.stringify(typeof v === "object" ? Object.keys(v as object).slice(0, 5) : String(v)).slice(0, 80);
  } catch (e) {
    results[name] = "ERR " + String((e as Error)?.message ?? e).split("\n")[0].slice(0, 200);
  }
}
const req = createRequire(projectDir + "/package.json");
await attempt("createRequire(builtin path)", () => req("path").basename("/a/b"));
await attempt("createRequire(cjs pkg)", () => req("cjs-fixture").version);
await attempt("createRequire(cjs relative file)", () => req("./lib/local.cjs"));
await attempt("createRequire(json)", () => req("./data.json").v);
await attempt("createRequire.resolve", () => req.resolve("cjs-fixture"));
await attempt("import(file:// .cjs)", async () => (await import(`file://${projectDir}/node_modules/cjs-fixture/index.cjs`)).default.version);
await attempt("import(file:// .mjs)", async () => (await import(`file://${projectDir}/node_modules/esm-fixture/index.mjs`)).value);
await attempt("import(file:// json with attr)", async () => (await import(`file://${projectDir}/data.json`, { with: { type: "json" } })).default.v);
await attempt("import(file:// .mjs importing cjs)", async () => (await import(`file://${projectDir}/bridge.mjs`)).default);
await attempt("import(npm:specifier)", async () => (await import("npm:left-pad@1.3.0")).default("x", 3));
console.log(JSON.stringify({ compiled: !!(Deno as unknown as { build: unknown }).build && import.meta.url.includes("deno-compile"), url: import.meta.url.slice(0, 60), results }, null, 1));
