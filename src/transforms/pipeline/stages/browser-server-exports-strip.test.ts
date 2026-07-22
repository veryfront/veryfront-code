import "#veryfront/schemas/_test-setup.ts";
import "../../plugins/__tests__/code-parser-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  browserServerExportsStripPlugin,
  stripServerOnlyExports,
} from "./browser-server-exports-strip.ts";
import type { TransformContext } from "../types.ts";

function assertNotIncludes(haystack: string, needle: string): void {
  assertEquals(haystack.includes(needle), false, `expected not to find ${needle} in:\n${haystack}`);
}

/** Identifier occurrences, so "kept the import" and "kept the binding" differ. */
function occurrences(haystack: string, name: string): number {
  return haystack.match(new RegExp(`\\b${name}\\b`, "g"))?.length ?? 0;
}

describe("browser-server-exports-strip", () => {
  describe("emptying server-only hooks", () => {
    it("empties an exported async function declaration body", async () => {
      const code = [
        `import { hashOf } from "../lib/uses-crypto.js";`,
        `async function getServerData(ctx) {`,
        `  return { props: { hashed: hashOf("hello") } };`,
        `}`,
        `function Page() { return null; }`,
        `export { getServerData, Page as default };`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, `hashOf("hello")`);
      // The binding survives so the export clause stays valid.
      assertStringIncludes(result, "getServerData");
      assertStringIncludes(result, "Page as default");
      assertStringIncludes(result, "return null");
    });

    it("empties a directly exported function declaration", async () => {
      const code = `export function getStaticPaths() { return db.query(); }`;
      const result = await stripServerOnlyExports(code);
      assertNotIncludes(result, "db.query");
      assertStringIncludes(result, "getStaticPaths");
    });

    it("replaces an exported arrow initialiser", async () => {
      const code = `export const getStaticData = async (ctx) => ({ props: { x: secret() } });`;
      const result = await stripServerOnlyExports(code);
      assertNotIncludes(result, "secret()");
      assertStringIncludes(result, "getStaticData");
    });

    it("removes default parameter dependencies from a function hook", async () => {
      const code = [
        `import { loadJob } from "../server/load-job.ts";`,
        `export async function getServerData(job = loadJob("fallback")) {`,
        `  return { props: { job } };`,
        `}`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "../server/load-job.ts");
      assertNotIncludes(result, "fallback");
      assertEquals(occurrences(result, "loadJob"), 0);
      assertStringIncludes(result, "function getServerData()");
    });

    it("handles all three hooks in one module", async () => {
      const code = [
        `export async function getServerData() { return serverOne(); }`,
        `export function getStaticData() { return serverTwo(); }`,
        `export const getStaticPaths = () => serverThree();`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "serverOne");
      assertNotIncludes(result, "serverTwo");
      assertNotIncludes(result, "serverThree");
    });

    it("leaves a module without server hooks untouched", async () => {
      const code = `import { x } from "./x.js";\nexport default function Page() { return x; }`;
      assertEquals(await stripServerOnlyExports(code), code);
    });

    it("does not treat a same-named string as a declaration", async () => {
      const code =
        `const label = "getServerData";\nexport default function Page() { return label; }`;
      assertEquals(await stripServerOnlyExports(code), code);
    });

    // Regression: a private helper is ordinary client code.
    it("leaves a non-exported function of the same name alone", async () => {
      const code = [
        `function getServerData() { return computeOnClient(); }`,
        `export default function Page() { return getServerData(); }`,
      ].join("\n");

      assertEquals(await stripServerOnlyExports(code), code);
    });

    // The runtime reads `mod.getServerData`, so this module has a real server
    // loader no matter what the function is called locally. Keying on the local
    // name shipped the body, its imports and anything it closed over.
    it("empties a hook exported under an alias", async () => {
      const code = [
        `import { hashOf } from "../lib/uses-crypto.js";`,
        `const API_KEY = "sk-live-example";`,
        `function loadIt() { return hashOf(API_KEY); }`,
        `export { loadIt as getServerData };`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "hashOf");
      assertStringIncludes(result, "getServerData");
      assertNotIncludes(result, "../lib/uses-crypto.js");
    });

    it("empties a hook declared before a separate export clause", async () => {
      const code = [
        `function getStaticData() { return readSecret(); }`,
        `export { getStaticData };`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);
      assertNotIncludes(result, "readSecret");
      assertStringIncludes(result, "getStaticData");
    });

    // Regression: `}` inside a regular expression literal used to end the body.
    it("keeps client code that follows a regular expression containing braces", async () => {
      const code = [
        `export async function getServerData() { return { props: { p: readSecret() } }; }`,
        `export default function Page() {`,
        `  const cleaned = "a}b".replace(/[{}]/g, "");`,
        `  return cleaned.split(/\\}/).length;`,
        `}`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "readSecret");
      assertStringIncludes(result, "cleaned");
      assertStringIncludes(result, "split");
    });

    it("keeps client code after a division that looks like a regular expression", async () => {
      const code = [
        `export function getStaticData() { return readSecret(); }`,
        `export default function Page(a, b) {`,
        `  const ratio = (a + b) / 2 / (a || 1);`,
        `  return { ratio };`,
        `}`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "readSecret");
      assertStringIncludes(result, "ratio");
    });

    it("handles a template literal with braces and interpolation", async () => {
      const code = [
        "export function getStaticData() { return readSecret(); }",
        "export default function Page(name) {",
        "  return `hello ${name} }{ ${`${name}`}`;",
        "}",
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "readSecret");
      assertStringIncludes(result, "hello ");
    });

    it("handles minified single-line input", async () => {
      const code =
        `import{hashOf as h}from"../lib/uses-crypto.js";export async function getServerData(){return{props:{v:h("x")}}}export default function P(){return 1}`;

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, `h("x")`);
      assertNotIncludes(result, "hashOf");
      assertStringIncludes(result, "getServerData");
    });

    it("handles TSX with types and JSX", async () => {
      const code = [
        `import { hashOf } from "../lib/uses-crypto.js";`,
        `import type { DataContext } from "veryfront";`,
        `export async function getServerData(_ctx: DataContext) {`,
        `  return { props: { hashed: hashOf("hello") } };`,
        `}`,
        `export default function Page({ hashed }: { hashed: string }) {`,
        `  return <main><code>{hashed}</code></main>;`,
        `}`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "page.tsx");

      assertNotIncludes(result, `hashOf("hello")`);
      assertStringIncludes(result, "hashed");
    });

    // Emitting a module this pass could not analyse would put the loader and
    // everything it closes over into the browser bundle. Stopping the build is
    // the only safe outcome.
    it("fails the build when a module naming a hook does not parse", async () => {
      const code = `export function getServerData( { this is not javascript`;

      const error = await assertRejects(() => stripServerOnlyExports(code, "pages/x.tsx"));

      assertStringIncludes((error as Error).message, "pages/x.tsx");
    });

    it("fails the build when a hook is re-exported from another module", async () => {
      const code = `export { loadIt as getServerData } from "./loader.ts";`;

      const error = await assertRejects(() => stripServerOnlyExports(code, "pages/x.tsx"));

      assertStringIncludes((error as Error).message, "getServerData");
    });

    it("fails the build when a hook is exported from a destructuring pattern", async () => {
      const code = [
        `import { loaders } from "./loaders.ts";`,
        `export const { getServerData } = loaders;`,
      ].join("\n");

      await assertRejects(() => stripServerOnlyExports(code, "pages/x.tsx"));
    });

    // The pre-check runs before anything else, so a module with no hook at all
    // is never parsed and can never fail the build.
    it("leaves a module that does not parse alone when it names no hook", async () => {
      const code = `export function somethingElse( { this is not javascript`;
      assertEquals(await stripServerOnlyExports(code), code);
    });
  });

  describe("import bindings", () => {
    it("removes an unreferenced project import outright", async () => {
      const code = [
        `import { loadOnStart } from "./client-init-and-data.ts";`,
        `export async function getServerData() { return loadOnStart(); }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "./client-init-and-data.ts");
      assertEquals(occurrences(result, "loadOnStart"), 0);
    });

    it("removes a hook-only page import so its transitive server graph is not fetched", async () => {
      const code = [
        `import { loadJob } from "../server/load-job.ts";`,
        `export async function getServerData(ctx) { return loadJob(ctx.params.id); }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "../server/load-job.ts");
      assertEquals(occurrences(result, "loadJob"), 0);
    });

    it("keeps an unrelated unused project import as a side-effect import", async () => {
      const code = [
        `import { initClientMetrics } from "./client-metrics.ts";`,
        `export async function getServerData() { return { props: {} }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `import "./client-metrics.ts"`);
      assertEquals(occurrences(result, "initClientMetrics"), 0);
    });

    it("keeps an unrelated import when a hook-local binding shadows its name", async () => {
      const code = [
        `import { initClientMetrics } from "./client-metrics.ts";`,
        `export async function getServerData() {`,
        `  const initClientMetrics = () => ({ props: {} });`,
        `  return initClientMetrics();`,
        `}`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `import "./client-metrics.ts"`);
      assertEquals(occurrences(result, "initClientMetrics"), 0);
    });

    it("removes a hook-only import even when a nested hook scope shadows its name", async () => {
      const code = [
        `import { loadJob } from "../server/load-job.ts";`,
        `export async function getServerData(ctx) {`,
        `  function nested() {`,
        `    const loadJob = () => "shadow";`,
        `    return loadJob();`,
        `  }`,
        `  nested();`,
        `  return loadJob(ctx.params.id);`,
        `}`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "../server/load-job.ts");
      assertEquals(occurrences(result, "loadJob"), 0);
    });

    it("keeps an unrelated unused import when a pruned helper has a nested local of the same name", async () => {
      const code = [
        `import { initClientMetrics } from "./client-metrics.ts";`,
        `function makeData() {`,
        `  function nested() {`,
        `    const initClientMetrics = () => "shadow";`,
        `    return initClientMetrics();`,
        `  }`,
        `  return { props: { value: nested() } };`,
        `}`,
        `export async function getServerData() { return makeData(); }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `import "./client-metrics.ts"`);
      assertEquals(occurrences(result, "initClientMetrics"), 0);
      assertEquals(occurrences(result, "makeData"), 0);
    });

    it("tracks a destructuring default dependency in a stripped hook", async () => {
      const code = [
        `import { loadJob } from "../server/load-job.ts";`,
        `export async function getServerData() {`,
        `  const { job = loadJob("fallback") } = {};`,
        `  return { props: { job } };`,
        `}`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "../server/load-job.ts");
      assertEquals(occurrences(result, "loadJob"), 0);
    });

    it("tracks a computed destructuring key dependency in a stripped hook", async () => {
      const code = [
        `import { loadJob } from "../server/load-job.ts";`,
        `export async function getServerData() {`,
        `  const { [loadJob("key")]: value } = {};`,
        `  return { props: { value } };`,
        `}`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "../server/load-job.ts");
      assertEquals(occurrences(result, "loadJob"), 0);
    });

    it("tracks a for-head destructuring default dependency in a stripped hook", async () => {
      const code = [
        `import { loadJob } from "../server/load-job.ts";`,
        `export async function getServerData() {`,
        `  for (const { job = loadJob("fallback") } of [{}]) {`,
        `    return { props: { job } };`,
        `  }`,
        `  return { props: {} };`,
        `}`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "../server/load-job.ts");
      assertEquals(occurrences(result, "loadJob"), 0);
    });

    it("keeps an unrelated import when a nested-block var shadows its name", async () => {
      const code = [
        `import { initClientMetrics } from "./client-metrics.ts";`,
        `export async function getServerData() {`,
        `  { var initClientMetrics = () => "shadow"; }`,
        `  return { props: { value: initClientMetrics() } };`,
        `}`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `import "./client-metrics.ts"`);
      assertEquals(occurrences(result, "initClientMetrics"), 0);
    });

    it("removes a hook-only import read after a for-loop block binding of the same name", async () => {
      const code = [
        `import { loadJob } from "../server/load-job.ts";`,
        `export async function getServerData() {`,
        `  for (let loadJob = 0; loadJob < 1; loadJob++) {}`,
        `  return { props: { job: loadJob("real") } };`,
        `}`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "../server/load-job.ts");
      assertEquals(occurrences(result, "loadJob"), 0);
    });

    it("removes a hook-only import read after a switch-case block binding of the same name", async () => {
      const code = [
        `import { loadJob } from "../server/load-job.ts";`,
        `export async function getServerData() {`,
        `  switch ("x") {`,
        `    case "x":`,
        `      const loadJob = () => "shadow";`,
        `      loadJob();`,
        `      break;`,
        `  }`,
        `  return { props: { job: loadJob("real") } };`,
        `}`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "../server/load-job.ts");
      assertEquals(occurrences(result, "loadJob"), 0);
    });

    it("keeps an unrelated import when a hook parameter default shadows its name", async () => {
      const code = [
        `import { ctx } from "./client-init.ts";`,
        `export async function getServerData(ctx = ctx) {`,
        `  return { props: { ok: Boolean(ctx) } };`,
        `}`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `import "./client-init.ts"`);
      assertEquals(occurrences(result, "ctx"), 0);
    });

    it("tracks a hook dependency inside TypeScript expression wrappers", async () => {
      const code = [
        `import { loadJob } from "../server/load-job.ts";`,
        `export async function getServerData() {`,
        `  return { props: { job: loadJob("real") as unknown } };`,
        `}`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "page.tsx");

      assertNotIncludes(result, "../server/load-job.ts");
      assertEquals(occurrences(result, "loadJob"), 0);
    });

    it("removes an unrelated unused veryfront import instead of rewriting it to a side-effect import", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `export async function getServerData() { return { props: {} }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, `"veryfront"`);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    it("removes an unreferenced node builtin import outright", async () => {
      const code = [
        `import { createHash } from "node:crypto";`,
        `export async function getServerData() { return createHash("sha256"); }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "node:crypto");
      assertEquals(occurrences(result, "createHash"), 0);
    });

    // Client-leak fix: an unused `veryfront` framework-barrel import must be
    // dropped entirely, not reduced to a bare `import "veryfront"`. Keeping it
    // as a side-effect import pulls the server runtime into the client bundle
    // and breaks hydration, so a page that used a framework export only inside a
    // server-only hook must not ship the barrel to the browser at all.
    it("removes an unreferenced bare veryfront import outright", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `export function getServerData() { return { props: { v: getEnv("X") } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      // The barrel is gone completely — not even a side-effect import survives.
      assertNotIncludes(result, `"veryfront"`);
      assertNotIncludes(result, `'veryfront'`);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    it("removes an unreferenced veryfront subpath import outright", async () => {
      const code = [
        `import { getEnv } from "veryfront/server";`,
        `export function getServerData() { return { props: { v: getEnv("X") } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "veryfront/server");
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    // Contrast pin: a NON-veryfront (project) import in the exact same shape is
    // also removed, because a hook-only import keeps its transitive graph in the
    // browser artifact when reduced to a side-effect import.
    it("removes a non-veryfront import in the same hook-only shape", async () => {
      const code = [
        `import { thing } from "./local";`,
        `export function getServerData() { return { props: { v: thing("X") } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, `./local`);
      assertEquals(occurrences(result, "thing"), 0);
    });

    // Secret-leak fix: a module-scope value computed for a server-only hook —
    // `const API_KEY = getEnv("SECRET_KEY")` read only inside getServerData —
    // must not survive into the browser output. Emptying the hook leaves it
    // dead; the pass now drops it, which in turn drops the framework import.
    it("drops a module-scope server value used only by a stripped hook", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const API_KEY = getEnv("SECRET_KEY");`,
        `export async function getServerData() { return { props: { ok: Boolean(API_KEY) } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertEquals(occurrences(result, "API_KEY"), 0);
      assertNotIncludes(result, "SECRET_KEY");
      assertEquals(occurrences(result, "getEnv"), 0);
      assertNotIncludes(result, `"veryfront"`);
    });

    // Contrast pin: the same value is KEPT when the browser component also reads
    // it — pruning is scoped to declarations nothing else references.
    it("keeps a module-scope value the client component also reads", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const REGION = getEnv("REGION");`,
        `export async function getServerData() { return { props: { r: REGION } }; }`,
        `export default function Page() { return REGION; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "REGION");
      assertEquals(occurrences(result, "REGION") > 0, true);
    });

    // Over-pruning guard: pruning is scoped to the stripped hook's closure, so
    // unrelated module-scope initialization with side effects (client analytics,
    // custom-element registration, instrumentation) sitting next to a server-only
    // hook must survive — only the hook's own closure is removed.
    it("keeps unrelated top-level side-effect declarations while dropping the hook's closure", async () => {
      const code = [
        `const clientInit = bootClientAnalytics();`,
        `function bootClientAnalytics() { globalThis.__booted = true; return true; }`,
        `import { getEnv } from "veryfront";`,
        `const API_KEY = getEnv("SECRET_KEY");`,
        `export async function getServerData() { return { props: { ok: Boolean(API_KEY) } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      // Unrelated client init and its helper are untouched (side effect kept).
      assertStringIncludes(result, "clientInit");
      assertStringIncludes(result, "bootClientAnalytics");
      // The hook's own closure still goes.
      assertEquals(occurrences(result, "API_KEY"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    // A chain fully feeds the hook: dropping one dead binding frees the next.
    it("drops a chain of module-scope bindings that only fed a stripped hook", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const RAW = getEnv("TOKEN");`,
        `const TOKEN = RAW.trim();`,
        `export async function getServerData() { return { props: { t: TOKEN } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertEquals(occurrences(result, "RAW"), 0);
      assertEquals(occurrences(result, "TOKEN"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    // The hook can be an arrow assigned to `const` — its closure must be
    // captured the same way as a `function` declaration before it is emptied.
    it("prunes the closure of a const-arrow hook form", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const API_KEY = getEnv("SECRET_KEY");`,
        `export const getServerData = async () => ({ props: { ok: Boolean(API_KEY) } });`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertEquals(occurrences(result, "API_KEY"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    // A module-scope helper *function* reached only from the hook is part of its
    // closure and goes; the same helper is kept the moment client code uses it.
    it("prunes a helper function only the hook used, keeps it when the client uses it", async () => {
      const onlyHook = [
        `import { getEnv } from "veryfront";`,
        `function computeKey() { return getEnv("SECRET_KEY"); }`,
        `export async function getServerData() { return { props: { k: computeKey() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");
      const strippedOnlyHook = await stripServerOnlyExports(onlyHook);
      assertEquals(occurrences(strippedOnlyHook, "computeKey"), 0);
      assertEquals(occurrences(strippedOnlyHook, "getEnv"), 0);

      const shared = [
        `function fmt(x) { return String(x); }`,
        `export async function getServerData() { return { props: { k: fmt(1) } }; }`,
        `export default function Page() { return fmt(2); }`,
      ].join("\n");
      const strippedShared = await stripServerOnlyExports(shared);
      assertStringIncludes(strippedShared, "function fmt");
    });

    // A chain member the client also reads is kept even though a later link in
    // the chain (used only by the hook) is dropped.
    it("keeps a chain member the client reads while dropping the hook-only tail", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const RAW = getEnv("X");`,
        `const TOKEN = RAW + "!";`,
        `export async function getServerData() { return { props: { t: TOKEN } }; }`,
        `export default function Page() { return RAW; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "RAW"); // client reads it → kept (with its import)
      assertStringIncludes(result, "getEnv");
      assertEquals(occurrences(result, "TOKEN"), 0); // hook-only tail → dropped
    });

    // Known limitation (pinned): a *destructured* server value is NOT pruned —
    // `moduleScopeDeclarations` handles only simple identifiers, to avoid
    // mishandling default-value references inside patterns. Conservative (never
    // over-prunes) but it means a destructured server value still ships. If this
    // ever needs closing, extend the declaration collector to safe patterns.
    it("conservatively keeps a destructured server value (documented limitation)", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const { a } = getEnv("X");`,
        `export async function getServerData() { return { props: { a } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      // Pinned as-is: the destructured binding and its import survive.
      assertStringIncludes(result, "getEnv");
    });

    it("keeps an import that the client still references", async () => {
      const code = [
        `import { formatDate } from "../lib/dates.js";`,
        `export async function getServerData() { return { props: {} }; }`,
        `export default function Page(props) { return formatDate(props.at); }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "formatDate");
      assertStringIncludes(result, "../lib/dates.js");
    });

    it("keeps an import when only one of its bindings is used", async () => {
      const code = [
        `import { a, b } from "./x.js";`,
        `export async function getServerData() { return b(); }`,
        `export default function Page() { return a(); }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "a, b");
    });

    it("keeps a bare side-effect import untouched", async () => {
      const code = [
        `import "../lib/polyfill.js";`,
        `export async function getServerData() { return { props: {} }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);
      assertStringIncludes(result, "polyfill.js");
    });

    it("keeps a default import the client renders with", async () => {
      const code = [
        `import React from "react";`,
        `export async function getServerData() { return { props: {} }; }`,
        `export default function Page() { return React.createElement("p"); }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);
      assertStringIncludes(result, `from "react"`);
    });

    it("removes a namespace import the client no longer uses", async () => {
      const code = [
        `import * as helpers from "../lib/util-bag.js";`,
        `export async function getServerData() { return helpers.load(); }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "../lib/util-bag.js");
      assertEquals(occurrences(result, "helpers"), 0);
    });

    it("does not count a matching property name as a reference", async () => {
      const code = [
        `import { hashOf } from "../lib/uses-crypto.js";`,
        `export async function getServerData() { return hashOf("x"); }`,
        `export default function Page(props) { return props.hashOf; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      // `props.hashOf` is a property name, not a reference to the import.
      assertStringIncludes(result, "props.hashOf");
      assertNotIncludes(result, "../lib/uses-crypto.js");
      assertEquals(occurrences(result, "hashOf"), 1);
    });

    it("counts a computed property access as a reference", async () => {
      const code = [
        `import { key } from "../lib/keys.js";`,
        `export async function getServerData() { return { props: {} }; }`,
        `export default function Page(props) { return props[key]; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);
      assertStringIncludes(result, "{ key }");
    });

    it("counts a JSX component as a reference", async () => {
      const code = [
        `import Badge from "../components/Badge.tsx";`,
        `export async function getServerData() { return { props: {} }; }`,
        `export default function Page() { return <Badge />; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "page.tsx");
      assertStringIncludes(result, "Badge from");
    });
  });

  // Regression: the scan used to count identifiers by matching text, so a name
  // that survived only in inert text kept a server-only import alive.
  describe("inert text is not a reference", () => {
    it("does not count a line comment mention", async () => {
      const code = [
        `import { createHash } from "node:crypto";`,
        `// createHash only ever runs in getServerData`,
        `export async function getServerData() { return createHash("sha256"); }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);
      assertNotIncludes(result, "node:crypto");
    });

    it("does not count a block comment mention", async () => {
      const code = [
        `import { createHash } from "node:crypto";`,
        `/* createHash hashes the slug on the server */`,
        `export async function getServerData() { return createHash("sha256"); }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);
      assertNotIncludes(result, "node:crypto");
    });

    it("does not count a string literal mention", async () => {
      const code = [
        `import { hashOf } from "../lib/uses-crypto.js";`,
        `export async function getServerData() { return hashOf("x"); }`,
        `export default function Page() { return "hashOf"; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      // Only the string survives, so the import is removed.
      assertEquals(occurrences(result, "hashOf"), 1);
      assertStringIncludes(result, `"hashOf"`);
      assertNotIncludes(result, "../lib/uses-crypto.js");
    });

    it("does not count a template literal mention", async () => {
      const code = [
        'import { hashOf } from "../lib/uses-crypto.js";',
        'export async function getServerData() { return hashOf("x"); }',
        "export default function Page() { return `hashOf`; }",
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertEquals(occurrences(result, "hashOf"), 1);
      assertNotIncludes(result, "../lib/uses-crypto.js");
    });

    it("counts a template literal interpolation, which is real code", async () => {
      const code = [
        'import { formatLabel } from "../lib/labels.js";',
        "export async function getServerData() { return { props: {} }; }",
        "export default function Page() { return `x ${formatLabel()} y`; }",
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "{ formatLabel }");
      assertStringIncludes(result, "../lib/labels.js");
    });

    it("does not count a JSX text node mention", async () => {
      const code = [
        `import { hashOf } from "../lib/uses-crypto.js";`,
        `export async function getServerData() { return hashOf("x"); }`,
        `export default function Page() { return <p>hashOf</p>; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "page.tsx");

      assertEquals(occurrences(result, "hashOf"), 1);
      assertNotIncludes(result, "../lib/uses-crypto.js");
    });
  });

  describe("declaration forms", () => {
    // Regression: a private helper that shares a hook's name is client code,
    // even when the module really does export a hook elsewhere.
    it("leaves a private same-named declaration alone beside a real hook", async () => {
      const code = [
        `function getServerData() { return computeOnClient(); }`,
        `export function getStaticData() { return readSecret(); }`,
        `export default function Page() { return getServerData(); }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "readSecret");
      assertStringIncludes(result, "computeOnClient");
    });

    it("empties both an aliased hook and a directly declared one", async () => {
      const code = [
        `function loadIt() { return readAliasedSecret(); }`,
        `export { loadIt as getServerData };`,
        `export function getStaticData() { return readSecret(); }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "readSecret()");
      assertNotIncludes(result, "readAliasedSecret");
    });

    // A local that merely shares a hook's name is ordinary client code: it is
    // the exported name that makes something server-only.
    it("leaves a local named like a hook but exported as something else alone", async () => {
      const code = [
        `function getServerData() { return computeOnClient(); }`,
        `export { getServerData as loadData };`,
      ].join("\n");

      assertEquals(await stripServerOnlyExports(code), code);
    });

    it("empties a hook declared as an exported function expression", async () => {
      const code = `export const getServerData = async function () { return readSecret(); };`;

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "readSecret");
      assertStringIncludes(result, "getServerData");
    });

    it("empties a hook declared as a directly exported async function", async () => {
      const code = `export async function getServerData() { return readSecret(); }`;

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "readSecret");
      assertStringIncludes(result, "getServerData");
    });
  });

  describe("plugin", () => {
    function ctx(code: string, target: "browser" | "ssr"): TransformContext {
      return { code, target, filePath: "pages/test.tsx" } as TransformContext;
    }

    it("drops the server-only import chain from the client artifact", async () => {
      const code = [
        `import { hashOf } from "@/lib/uses-crypto";`,
        `export async function getServerData(_ctx) {`,
        `  return { props: { hashed: hashOf("hello") } };`,
        `}`,
        `function TestD({ hashed }) { return hashed; }`,
        `export { TestD as default };`,
      ].join("\n");

      const result = await browserServerExportsStripPlugin.transform(ctx(code, "browser"));

      assertEquals(occurrences(result, "hashOf"), 0);
      assertNotIncludes(result, "@/lib/uses-crypto");
      assertStringIncludes(result, "TestD as default");
    });

    it("does not run for the ssr target", () => {
      assertEquals(browserServerExportsStripPlugin.condition?.(ctx("", "ssr")), false);
      assertEquals(browserServerExportsStripPlugin.condition?.(ctx("", "browser")), true);
    });
  });
});
