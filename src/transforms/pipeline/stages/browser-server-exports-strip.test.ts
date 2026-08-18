import "#veryfront/schemas/_test-setup.ts";
import "../../plugins/__tests__/code-parser-setup.ts";
import { stop as stopEsbuild } from "#veryfront/platform/compat/esbuild.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { CodeParser } from "#veryfront/extensions/parser/index.ts";
import {
  browserServerExportsStripPlugin,
  moduleReferenceWalkers,
  stripServerOnlyExports,
} from "./browser-server-exports-strip.ts";
import { COMPILE_SOURCE_MAP_DIRECTIVE_METADATA, compilePlugin } from "./compile.ts";
import { runPipeline } from "../index.ts";
import { type TransformContext, TransformStage } from "../types.ts";

function assertNotIncludes(haystack: string, needle: string): void {
  assertEquals(haystack.includes(needle), false, `expected not to find ${needle} in:\n${haystack}`);
}

/** Identifier occurrences, so "kept the import" and "kept the binding" differ. */
function occurrences(haystack: string, name: string): number {
  return haystack.match(new RegExp(`\\b${name}\\b`, "g"))?.length ?? 0;
}

describe("browser-server-exports-strip", () => {
  afterAll(async () => {
    await stopEsbuild();
  });

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

    // An imported binding re-exported under a hook name has no local
    // declaration to stub. Emitting the module unchanged would keep the import
    // — and the loader module behind it — in the browser graph, so the build
    // stops instead. (This form used to pass through silently.)
    it("fails the build when a hook is an imported binding re-exported locally", async () => {
      const code = [
        `import { loadIt } from "./loader.ts";`,
        `export { loadIt as getServerData };`,
      ].join("\n");

      const error = await assertRejects(() => stripServerOnlyExports(code, "pages/x.tsx"));

      assertStringIncludes((error as Error).message, "pages/x.tsx");
    });

    // ES2022 lets an export clause publish an arbitrary string as the exported
    // name, and the runtime looks `mod.getServerData` up under it just the
    // same. The name matcher only ever read the identifier form, so the module
    // was reported as exporting no hook and passed through byte for byte —
    // loader body, imports and closed-over secrets included.
    it("fails the build when a hook is exported under a string-literal name", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const API_KEY = getEnv("SECRET_KEY");`,
        `async function loadIt() { return { props: { k: API_KEY } }; }`,
        `export { loadIt as "getServerData" };`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() => stripServerOnlyExports(code, "pages/x.tsx"));

      assertStringIncludes((error as Error).message, "getServerData");
    });

    // `export * as getServerData from "./loader"` names a hook without binding
    // anything locally, so there is nothing to stub and the loader module stays
    // in the browser graph.
    it("fails the build when a hook is a namespace re-export", async () => {
      const code = `export * as getServerData from "./loader.ts";`;

      const error = await assertRejects(() => stripServerOnlyExports(code, "pages/x.tsx"));

      assertStringIncludes((error as Error).message, "getServerData");
    });

    // A class declaration exported under a hook name is a form the stubber
    // does not handle. Fail closed rather than shipping the class body and
    // everything it closes over.
    it("fails the build when a hook is exported as a class declaration", async () => {
      const code = `export class getServerData { load() { return readSecret(); } }`;

      const error = await assertRejects(() => stripServerOnlyExports(code, "pages/x.tsx"));

      assertStringIncludes((error as Error).message, "getServerData");
    });

    // A module-scope reassignment defeats stubbing: the pass empties the
    // declarator, but the assignment puts the real loader back at
    // module-evaluation time, so the loader body and its imports would ship to
    // the browser and overwrite the stub. This form used to be reported as
    // successfully emptied while the real loader shipped silently; it now
    // fails closed.
    it("fails the build when an exported hook binding is reassigned at module scope", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `export let getServerData = async () => null;`,
        `getServerData = async () => ({ props: { secret: getEnv("SECRET_A") } });`,
      ].join("\n");

      const error = await assertRejects(() => stripServerOnlyExports(code, "pages/x.tsx"));

      assertStringIncludes((error as Error).message, "getServerData");
      assertStringIncludes((error as Error).message, "reassigned");
    });

    it("fails the build when a hook is reassigned to an imported server loader", async () => {
      const code = [
        `import { realLoader } from "./server/db.ts";`,
        `export let getServerData;`,
        `getServerData = realLoader;`,
      ].join("\n");

      const error = await assertRejects(() => stripServerOnlyExports(code, "pages/x.tsx"));

      assertStringIncludes((error as Error).message, "getServerData");
    });

    it("fails the build when a separately exported hook binding is reassigned", async () => {
      const code = [
        `let getServerData;`,
        `getServerData = async () => ({ props: { s: readSecret() } });`,
        `export { getServerData };`,
      ].join("\n");

      await assertRejects(() => stripServerOnlyExports(code, "pages/x.tsx"));
    });

    it("fails the build when a hook binding is written by a destructuring assignment", async () => {
      const code = [
        `import { loaders } from "./loaders.ts";`,
        `export let getServerData = async () => null;`,
        `({ getServerData } = loaders);`,
      ].join("\n");

      await assertRejects(() => stripServerOnlyExports(code, "pages/x.tsx"));
    });

    // A `var` below the top level binds the same module-scope name as the
    // exported hook, but the stubber only rewrites top-level declarations and
    // the assignment scan only sees assignment and update expressions. Both
    // used to miss it, so the artifact carried the stub *and* the real loader,
    // and the hoisted initialiser overwrote the stub at module evaluation.
    const hoistedVarForms: Array<[string, string]> = [
      ["a bare block", `{ var getServerData = realLoader; }`],
      ["an if branch", `if (globalThis.cond) { var getServerData = realLoader; }`],
      ["a for-of head", `for (var getServerData of [realLoader]) {}`],
      ["a for-in head", `for (var getServerData in { a: realLoader }) {}`],
      ["a for init", `for (var getServerData = realLoader; false;) {}`],
      ["a switch case", `switch (globalThis.k) { case 1: var getServerData = realLoader; }`],
      ["a try block", `try { var getServerData = realLoader; } catch { }`],
      ["a catch block", `try { } catch (e) { var getServerData = realLoader; }`],
      ["a finally block", `try { } finally { var getServerData = realLoader; }`],
      ["a labelled block", `outer: { var getServerData = realLoader; }`],
      ["a while body", `while (globalThis.cond) { var getServerData = realLoader; }`],
      ["a nested loop", `if (a) { for (;;) { var getServerData = realLoader; } }`],
      ["a destructuring pattern", `{ var { getServerData } = { getServerData: realLoader }; }`],
    ];

    for (const [description, redeclaration] of hoistedVarForms) {
      it(`fails the build when a hook binding is redeclared by a hoisted var in ${description}`, async () => {
        const code = [
          `import { realLoader } from "./server/db.ts";`,
          `export var getServerData = async () => null;`,
          redeclaration,
        ].join("\n");

        const error = await assertRejects(() => stripServerOnlyExports(code, "pages/x.tsx"));

        assertStringIncludes((error as Error).message, "getServerData");
        assertStringIncludes((error as Error).message, "redeclared");
      });
    }

    // The mirror image: a `var` inside a function is function-scoped and never
    // reaches the module binding, so it must not stop the build. Failing closed
    // on these would reject ordinary client code that happens to reuse a name.
    it("strips normally when a var with a hook name is local to a nested function", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `export var getServerData = async () => ({ props: { s: getEnv("SECRET_A") } });`,
        `export default function Page() {`,
        `  if (globalThis.cond) { var getServerData = 1; }`,
        `  return getServerData;`,
        `}`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/x.tsx");

      assertStringIncludes(result, `throw new Error("server-only")`);
      assertEquals(result.includes("SECRET_A"), false);
      assertEquals(result.includes("veryfront"), false);
    });

    // A class static block is its own `var` scope, so it does not hoist either.
    it("strips normally when a var with a hook name is local to a class static block", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `export async function getServerData() { return getEnv("SECRET_A"); }`,
        `class Registry { static { var getServerData = 1; globalThis.x = getServerData; } }`,
        `export default function Page() { return Registry; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/x.tsx");

      assertStringIncludes(result, `throw new Error("server-only")`);
      assertEquals(result.includes("SECRET_A"), false);
    });

    // `let`/`const` in a block are block-scoped: a same-named binding there is
    // a different variable and leaves the exported stub alone.
    it("strips normally when a block-scoped let shadows a hook name", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `export async function getServerData() { return getEnv("SECRET_A"); }`,
        `{ let getServerData = 1; globalThis.x = getServerData; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/x.tsx");

      assertStringIncludes(result, `throw new Error("server-only")`);
      assertEquals(result.includes("SECRET_A"), false);
    });

    // The pre-check runs before anything else, so a module with no hook at all
    // is never parsed and can never fail the build.
    it("leaves a module that does not parse alone when it names no hook", async () => {
      const code = `export function somethingElse( { this is not javascript`;
      assertEquals(await stripServerOnlyExports(code), code);
    });
  });

  describe("import bindings", () => {
    // The binding is hook-owned even though the module it comes from also runs
    // client init. Dropping it costs those side effects; keeping a side-effect
    // import would pull the module's server graph into the browser, which is
    // what this stage exists to prevent. Contrast the ./client-metrics.ts cases
    // below, where nothing in the hook ever touched the binding.
    it("removes a hook-owned project import even when its module also runs client init", async () => {
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

    it("pre-binds lexical declarations across switch cases", async () => {
      const code = [
        `import { loadJob } from "../server/load-job.ts";`,
        `export async function getServerData() {`,
        `  return { props: { job: loadJob("server") } };`,
        `}`,
        `export default function Page(value) {`,
        `  switch (value) {`,
        `    case "read":`,
        `      return loadJob("shadowed");`,
        `    case "declare":`,
        `      const loadJob = () => "local";`,
        `      return loadJob();`,
        `  }`,
        `}`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "../server/load-job.ts");
      assertEquals(occurrences(result, "loadJob"), 3);
    });

    it("pre-binds lexical declarations before switch case tests", async () => {
      const code = [
        `import { loadJob } from "../server/load-job.ts";`,
        `export async function getServerData() {`,
        `  return { props: { job: loadJob("server") } };`,
        `}`,
        `export default function Page(value) {`,
        `  switch (value) {`,
        `    case loadJob("shadowed"):`,
        `      return null;`,
        `    case "declare":`,
        `      let loadJob = () => "local";`,
        `      return loadJob();`,
        `  }`,
        `}`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "../server/load-job.ts");
      assertEquals(occurrences(result, "loadJob"), 3);
    });

    it("keeps an unrelated import when a hook parameter default shadows its name", async () => {
      const code = [
        `import { ctx } from "./client-init.ts";`,
        `export async function getServerData({ ctx = "shadow" } = {}) {`,
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

    it("keeps unrelated top-level side effects that share a global with the hook", async () => {
      const code = [
        `const clientInit = console.log("client");`,
        `export async function getServerData() { console.log("server"); return { props: {} }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "clientInit");
      assertStringIncludes(result, 'console.log("client")');
      assertNotIncludes(result, 'console.log("server")');
    });

    it("keeps unrelated top-level side effects that share an import with the hook", async () => {
      const code = [
        `import { report } from "./analytics.ts";`,
        `const clientInit = report("client");`,
        `export async function getServerData() { report("server"); return { props: {} }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "clientInit");
      assertStringIncludes(result, 'report("client")');
      assertNotIncludes(result, 'report("server")');
      assertStringIncludes(result, 'from "./analytics.ts"');
    });

    it("keeps unrelated co-declared client initializers while dropping hook-only bindings", async () => {
      const code = [
        `const secret = serverOnly(), boot = bootClient();`,
        `function serverOnly() { return "SECRET"; }`,
        `function bootClient() { globalThis.__booted = true; return true; }`,
        `export async function getServerData() { return { props: { secret } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertEquals(occurrences(result, "secret"), 0);
      assertNotIncludes(result, "serverOnly");
      assertNotIncludes(result, "SECRET");
      assertStringIncludes(result, "boot = bootClient()");
      assertStringIncludes(result, "function bootClient()");
    });

    // Silent-leak fix. Liveness used to ask what the module reads once the
    // hook's own closure is elided, which made every *other* declaration
    // unconditionally live — including ones nothing calls. A private helper the
    // module never reaches then counted as a browser reader of `createHash` and
    // kept the `node:crypto` import, which is the hydration failure this stage
    // exists to prevent. A declaration that runs nothing and that nothing
    // reaches is not a reason to keep anything alive.
    it("drops a dead private helper that was pinning a node builtin import", async () => {
      const code = [
        `import { createHash } from "node:crypto";`,
        `function deadHelper() { return createHash("sha1"); }`,
        `export async function getServerData() { return { props: { h: createHash("sha256") } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "node:crypto");
      assertEquals(occurrences(result, "createHash"), 0);
      assertEquals(occurrences(result, "deadHelper"), 0);
    });

    it("drops a dead helper that was sharing the hook's secret", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const deadHelper = () => KEY;`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertEquals(occurrences(result, "KEY"), 0);
      assertNotIncludes(result, "SECRET_KEY");
      assertEquals(occurrences(result, "deadHelper"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    it("drops a dead class that was holding the hook's secret", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `class DeadLoader { run() { return KEY; } }`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertEquals(occurrences(result, "KEY"), 0);
      assertNotIncludes(result, "SECRET_KEY");
      assertEquals(occurrences(result, "DeadLoader"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    // Two dead helpers that call each other are each the other's last consumer,
    // so no per-declaration rule can ever free the secret they share.
    it("drops a dead helper cycle that was holding the hook's secret", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function first() { return second() + KEY; }`,
        `function second() { return first(); }`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertEquals(occurrences(result, "KEY"), 0);
      assertNotIncludes(result, "SECRET_KEY");
      assertEquals(occurrences(result, "first"), 0);
      assertEquals(occurrences(result, "second"), 0);
    });

    // The same gap in the shape that survives esbuild's production tree-shaker:
    // a `var` inside an `if`, `switch`, loop or `try` is not provably pure, so
    // it reaches this stage and used to root whatever it reads.
    it("drops a hook-only secret read only by a hoisted var in an impure guard", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `if (globalThis.debug) { var dead = KEY; }`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertEquals(occurrences(result, "KEY"), 0);
      assertNotIncludes(result, "SECRET_KEY");
      assertEquals(occurrences(result, "dead"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    it("keeps a tainted initializer whose identifier read is still in the TDZ", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const dead = later && KEY;`,
        `const later = true;`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "const dead = later && KEY");
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("keeps a tainted initializer whose identifier read may be unresolved", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const dead = missingGlobal && KEY;`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "const dead = missingGlobal && KEY");
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("keeps a module initializer shadowed by a catch-pattern TDZ", async () => {
      const code = [
        `const KEY = bootClient();`,
        `export async function getServerData() {`,
        `  try { throw {}; } catch ({ KEY = KEY }) { return { props: {} }; }`,
        `}`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "const KEY = bootClient()");
    });

    it("drops a helper reached only from a hoisted var in an impure guard", async () => {
      const code = [
        `import { createHash } from "node:crypto";`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function deadHelper() { return createHash("sha1") + KEY; }`,
        `if (globalThis.debug) { var dead = deadHelper; }`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "node:crypto");
      assertNotIncludes(result, "SECRET_KEY");
      assertEquals(occurrences(result, "deadHelper"), 0);
      assertEquals(occurrences(result, "dead"), 0);
    });

    // A declaration that *does* run at module load is still elided when every
    // binding it evaluates is already the hooks': the only thing it can pin is
    // one this pass owns.
    it("drops a hoisted var whose initialiser only calls a hook-only import", async () => {
      const code = [
        `import { createHash } from "node:crypto";`,
        `switch (globalThis.mode) { case 1: var dead = createHash("md5"); }`,
        `export async function getServerData() { return { props: { h: createHash("sha256") } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "node:crypto");
      assertEquals(occurrences(result, "createHash"), 0);
      assertEquals(occurrences(result, "dead"), 0);
    });

    // Over-pruning guard for the wider reachability: removal stays scoped to
    // the hooks' closure, so a helper nothing calls that holds nothing
    // server-only is left exactly where it is. This stage is not a general
    // dead-code eliminator.
    it("keeps a dead helper that holds nothing from the hook's closure", async () => {
      const code = [
        `import { fmt } from "./util.ts";`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function unusedClientHelper() { return fmt("x"); }`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertEquals(occurrences(result, "KEY"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
      assertStringIncludes(result, "function unusedClientHelper");
      assertStringIncludes(result, "./util.ts");
    });

    // A dev build wraps every initialiser in esbuild's `keepNames` helper and
    // compiles a class's registration into a static block. Neither is a call
    // the module makes, so neither may turn a dead declaration into live code —
    // but the helper performing them stays for as long as one still runs.
    it("drops dead declarations wrapped in compiler name registrations", async () => {
      const code = [
        `var defineName = Object.defineProperty;`,
        `var setName = (target, value) => defineName(target, "name", { value, configurable: true });`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const deadHelper = setName(() => KEY, "deadHelper");`,
        `class DeadLoader { static { setName(this, "DeadLoader"); } run() { return KEY; } }`,
        `function loadServer() { return KEY; }`,
        `setName(loadServer, "getServerData");`,
        `function Page() { return null; }`,
        `setName(Page, "Page");`,
        `export { Page as default, loadServer as getServerData };`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertEquals(occurrences(result, "KEY"), 0);
      assertNotIncludes(result, "SECRET_KEY");
      assertEquals(occurrences(result, "deadHelper"), 0);
      assertEquals(occurrences(result, "DeadLoader"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
      assertStringIncludes(result, `setName(Page, "Page")`);
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

    // Production release modules have already passed through esbuild with
    // `keepNames`, which emits a top-level name-registration call for every
    // function. That compiler metadata must not turn a hook-only helper into a
    // browser reference and keep its server import graph alive.
    it("prunes hook-only helpers from compiled keepNames output", async () => {
      const code = [
        `var defineName = Object.defineProperty;`,
        `var setName = (target, value) => defineName(target, "name", { value, configurable: true });`,
        `import { getActivity } from "../lib/api.js";`,
        `async function loadReview() { return getActivity(); }`,
        `setName(loadReview, "getReviewProps");`,
        `function loadStatic() { return loadReview(); }`,
        `setName(loadStatic, "getStaticData");`,
        `function loadServer() { return loadReview(); }`,
        `setName(loadServer, "getServerData");`,
        `function Page() { return null; }`,
        `setName(Page, "Page");`,
        `export { Page as default, loadServer as getServerData, loadStatic as getStaticData };`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "../lib/api.js");
      assertEquals(occurrences(result, "getActivity"), 0);
      assertEquals(occurrences(result, "loadReview"), 0);
      assertStringIncludes(result, `setName(Page, "Page")`);
    });

    it("keeps helpers consumed by ordinary top-level registration", async () => {
      const code = [
        `import { getActivity } from "../lib/api.js";`,
        `async function loadReview() { return getActivity(); }`,
        `registerClientHandler(loadReview, "review-loader");`,
        `function loadServer() { return loadReview(); }`,
        `export { loadServer as getServerData };`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "../lib/api.js");
      assertStringIncludes(result, "registerClientHandler(loadReview");
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

    // Regression (closed leak): a *destructured* module-scope server value used
    // only by a stripped hook used to survive into the browser output, because
    // the declaration collector handled only simple identifiers. The pattern is
    // now a removal candidate as a whole, so the binding, the initialiser call
    // and the import it was the last user of all go. This is also the case
    // esbuild's tree-shaker can never close: a destructuring of a call — even a
    // `@__PURE__`-annotated one — is kept in both transform and bundle mode
    // because the pattern may trigger getters or throw.
    it("drops a destructured module-scope server value used only by a stripped hook", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const { a } = getEnv("X");`,
        `export async function getServerData() { return { props: { a } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertEquals(occurrences(result, "a"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
      assertNotIncludes(result, `"veryfront"`);
      assertNotIncludes(result, `"X"`);
    });

    it("drops a destructured server secret and the import it was the last user of", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const { apiKey, region } = getEnv("SECRET_CONFIG");`,
        `export async function getServerData() { return { props: { ok: Boolean(apiKey), region } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertEquals(occurrences(result, "apiKey"), 0);
      assertEquals(occurrences(result, "region"), 0);
      assertNotIncludes(result, "SECRET_CONFIG");
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    it("drops an array-pattern server value used only by a stripped hook", async () => {
      const code = [
        `import { loadKeys } from "../server/keys.ts";`,
        `const [primaryKey] = loadKeys();`,
        `export async function getServerData() { return { props: { primaryKey } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertEquals(occurrences(result, "primaryKey"), 0);
      assertEquals(occurrences(result, "loadKeys"), 0);
      assertNotIncludes(result, "../server/keys.ts");
    });

    it("drops a rest-pattern server value used only by a stripped hook", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const { token, ...serverConfig } = getEnv("CFG");`,
        `export async function getServerData() { return { props: { token, serverConfig } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertEquals(occurrences(result, "token"), 0);
      assertEquals(occurrences(result, "serverConfig"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    // Contrast pin: a pattern is removed only as a whole. When the client still
    // reads one of its bindings, the whole declarator — and its import — stay.
    it("keeps a destructured value the client component also reads", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const { apiKey, region } = getEnv("CFG");`,
        `export async function getServerData() { return { props: { ok: Boolean(apiKey) } }; }`,
        `export default function Page() { return region; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "region");
      assertStringIncludes(result, "apiKey");
      assertStringIncludes(result, "getEnv");
    });

    it("drops a destructured server value when client code only shadows its binding", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const { apiKey } = getEnv("SERVER_SECRET_CFG");`,
        `export async function getServerData() { return { props: { apiKey } }; }`,
        `export default function Page() { const apiKey = "public"; return apiKey; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, 'apiKey = "public"');
      assertNotIncludes(result, "SERVER_SECRET_CFG");
      assertNotIncludes(result, "getEnv");
      assertNotIncludes(result, '"veryfront"');
    });

    it("drops a hook-only chain when client code shadows an intermediate helper", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const { raw } = getEnv("SERVER_SECRET_CFG");`,
        `function formatSecret() { return raw.trim(); }`,
        `export async function getServerData() { return { props: { value: formatSecret() } }; }`,
        `export default function Page() { const formatSecret = () => "public"; return formatSecret(); }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, 'formatSecret = () => "public"');
      assertNotIncludes(result, "SERVER_SECRET_CFG");
      assertNotIncludes(result, "raw.trim");
      assertNotIncludes(result, "getEnv");
      assertNotIncludes(result, '"veryfront"');
    });

    it("drops a hook-only import when client code shadows the imported binding", async () => {
      const code = [
        `import { loadSecret } from "../server/secrets.ts";`,
        `const secret = loadSecret();`,
        `export async function getServerData() { return { props: { secret } }; }`,
        `export default function Page() { const loadSecret = () => "public"; return loadSecret(); }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, 'loadSecret = () => "public"');
      assertNotIncludes(result, "../server/secrets.ts");
      assertNotIncludes(result, "const secret =");
    });

    it("drops a hook-only import shadowed by a named client class expression", async () => {
      const code = [
        `import { loadSecret } from "../server/secrets.ts";`,
        `const secret = loadSecret();`,
        `export async function getServerData() { return { props: { secret } }; }`,
        `export default function Page() {`,
        `  const ClientValue = class loadSecret { static self = loadSecret; };`,
        `  return ClientValue.self;`,
        `}`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "class loadSecret");
      assertStringIncludes(result, "static self = loadSecret");
      assertNotIncludes(result, "../server/secrets.ts");
      assertNotIncludes(result, "const secret =");
    });

    it("keeps an import read by a TypeScript parameter property default", async () => {
      const code = [
        `import { loadSecret } from "../server/secrets.ts";`,
        `export async function getServerData() { return loadSecret("server"); }`,
        `export default class Page {`,
        `  constructor(private value = loadSecret("client")) {}`,
        `}`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "../server/secrets.ts");
      assertStringIncludes(result, 'loadSecret("client")');
      assertNotIncludes(result, 'loadSecret("server")');
    });

    it("keeps an import read by a TypeScript parameter property decorator", async () => {
      const code = [
        `import { loadSecret } from "../server/secrets.ts";`,
        `export async function getServerData() { return loadSecret("server"); }`,
        `export default class Page {`,
        `  constructor(@inject(loadSecret) private value = "client") {}`,
        `}`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, 'import { loadSecret } from "../server/secrets.ts"');
      assertStringIncludes(result, "@inject(loadSecret)");
      assertNotIncludes(result, 'loadSecret("server")');
    });

    // Only a `TSParameterProperty` used to have its decorators traversed, but
    // Babel hangs them off an ordinary parameter too. The reads were invisible,
    // so the import went and the surviving decorator was left unresolved.
    it("keeps an import read by a decorator on an ordinary parameter", async () => {
      const code = [
        `import { inject, loadSecret } from "../server/secrets.ts";`,
        `export async function getServerData() { return loadSecret("server"); }`,
        `export default class Page {`,
        `  constructor(@inject(loadSecret) value) { this.value = value; }`,
        `}`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, 'import { inject, loadSecret } from "../server/secrets.ts"');
      assertStringIncludes(result, "@inject(loadSecret)");
      assertNotIncludes(result, 'loadSecret("server")');
    });

    it("keeps an import read by a parameter-property decorator shadowed by the parameter", async () => {
      const code = [
        `import { secret } from "../server/secrets.ts";`,
        `export async function getServerData() { return secret("server"); }`,
        `export default class Page {`,
        `  constructor(@inject(secret) private secret: string) {}`,
        `}`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, 'import { secret } from "../server/secrets.ts"');
      assertStringIncludes(result, "@inject(secret)");
      assertNotIncludes(result, 'secret("server")');
    });

    for (
      const [description, parameter] of [
        ["identifier", "@inject(loadSecret) value: string"],
        ["defaulted parameter", '@inject(loadSecret) value = "client"'],
        ["destructured parameter", "@inject(loadSecret) { value }: { value: string }"],
      ] as const
    ) {
      it(`keeps an import read by an ordinary decorated ${description}`, async () => {
        const code = [
          `import { loadSecret } from "../server/secrets.ts";`,
          `export async function getServerData() { return loadSecret("server"); }`,
          `export default class Page {`,
          `  constructor(${parameter}) {}`,
          `}`,
        ].join("\n");

        const result = await stripServerOnlyExports(code);

        assertStringIncludes(result, 'import { loadSecret } from "../server/secrets.ts"');
        assertStringIncludes(result, "@inject(loadSecret)");
        assertNotIncludes(result, 'loadSecret("server")');
      });
    }

    it("does not treat a private property name as an import read", async () => {
      const code = [
        `import { loadSecret } from "../server/secrets.ts";`,
        `export async function getServerData() { return loadSecret("server"); }`,
        `export default class Page {`,
        `  #loadSecret = "client";`,
        `  render() { return this.#loadSecret; }`,
        `}`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "../server/secrets.ts");
      assertStringIncludes(result, '#loadSecret = "client"');
      assertStringIncludes(result, "this.#loadSecret");
    });

    it("does not treat an auto-accessor name as an import read", async () => {
      const code = [
        `import { loadSecret } from "../server/secrets.ts";`,
        `export async function getServerData() { return loadSecret("server"); }`,
        `export default class Page {`,
        `  accessor loadSecret = "client";`,
        `}`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "../server/secrets.ts");
      assertStringIncludes(result, 'accessor loadSecret = "client"');
    });

    it("scopes private method parameters before pruning imports", async () => {
      const code = [
        `import { loadSecret } from "../server/secrets.ts";`,
        `export async function getServerData() { return loadSecret("server"); }`,
        `export default class Page {`,
        `  #format(loadSecret: string) { return loadSecret; }`,
        `  render() { return this.#format("client"); }`,
        `}`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "../server/secrets.ts");
      assertStringIncludes(result, "#format(loadSecret: string)");
      assertStringIncludes(result, "return loadSecret");
    });

    it("keeps an unreferenced class whose parameter decorator runs at definition time", async () => {
      const code = [
        `import { inject, secret } from "../server/secrets.ts";`,
        `class Registration {`,
        `  constructor(@inject(secret) value: string) {}`,
        `}`,
        `export async function getServerData() { return secret("server"); }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, 'import { inject, secret } from "../server/secrets.ts"');
      assertStringIncludes(result, "class Registration");
      assertStringIncludes(result, "@inject(secret)");
      assertNotIncludes(result, 'secret("server")');
    });

    it("drops a runtime TypeScript enum used only by a stripped hook", async () => {
      const code = [
        `import { randomUUID } from "node:crypto";`,
        `enum ServerStatus { Ready = randomUUID() }`,
        `export async function getServerData() { return ServerStatus.Ready; }`,
        `export default function Page() { return "client"; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "node:crypto");
      assertNotIncludes(result, "ServerStatus");
      assertNotIncludes(result, "randomUUID");
    });

    it("keeps an import read by a runtime TypeScript enum used by the client", async () => {
      const code = [
        `import { randomUUID } from "node:crypto";`,
        `enum ClientStatus { Ready = randomUUID() }`,
        `export async function getServerData() { return randomUUID(); }`,
        `export default function Page() { return ClientStatus.Ready; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, 'import { randomUUID } from "node:crypto"');
      assertStringIncludes(result, "enum ClientStatus");
      assertStringIncludes(result, "randomUUID()");
    });

    it("drops a runtime TypeScript namespace used only by a stripped hook", async () => {
      const code = [
        `import { randomUUID } from "node:crypto";`,
        `namespace ServerStatus { export const Ready = randomUUID(); }`,
        `export async function getServerData() { return ServerStatus.Ready; }`,
        `export default function Page() { return "client"; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "node:crypto");
      assertNotIncludes(result, "ServerStatus");
      assertNotIncludes(result, "randomUUID");
    });

    it("keeps an import read by a runtime TypeScript namespace used by the client", async () => {
      const code = [
        `import { randomUUID } from "node:crypto";`,
        `namespace ClientStatus { export const Ready = randomUUID(); }`,
        `export async function getServerData() { return randomUUID(); }`,
        `export default function Page() { return ClientStatus.Ready; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, 'import { randomUUID } from "node:crypto"');
      assertStringIncludes(result, "namespace ClientStatus");
      assertStringIncludes(result, "randomUUID()");
    });

    it("binds a hoisted var nested inside a runtime TypeScript namespace", async () => {
      const code = [
        `import { loadSecret } from "../server/secrets.ts";`,
        `const publicValue = "client";`,
        `namespace Client {`,
        `  export const value = loadSecret;`,
        `  if (globalThis.cond) { var loadSecret = publicValue; }`,
        `}`,
        `export async function getServerData() { return loadSecret("server"); }`,
        `export default function Page() { return Client.value; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "../server/secrets.ts");
      assertStringIncludes(result, "namespace Client");
      assertStringIncludes(result, "var loadSecret = publicValue");
      assertStringIncludes(result, "export const value = loadSecret");
    });

    it("does not hoist a namespace var into the enclosing module", async () => {
      const code = [
        `import { loadSecret } from "../server/secrets.ts";`,
        `namespace Client {`,
        `  if (globalThis.cond) { var loadSecret = "client"; }`,
        `  export const value = loadSecret;`,
        `}`,
        `export async function getServerData() { return "server"; }`,
        `export default function Page() { return loadSecret(); }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, 'import { loadSecret } from "../server/secrets.ts"');
      assertStringIncludes(result, "return loadSecret()");
    });

    it("drops a TypeScript import-equals binding used only by a stripped hook", async () => {
      const code = [
        `import crypto = require("node:crypto");`,
        `export async function getServerData() { return crypto.randomUUID(); }`,
        `export default function Page() { return "client"; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "node:crypto");
      assertNotIncludes(result, "import crypto");
      assertNotIncludes(result, "crypto.randomUUID");
    });

    it("keeps a TypeScript import-equals binding used by the client", async () => {
      const code = [
        `import crypto = require("node:crypto");`,
        `export async function getServerData() { return crypto.randomUUID(); }`,
        `export default function Page() { return crypto.randomUUID(); }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, 'import crypto = require("node:crypto")');
      assertStringIncludes(result, "return crypto.randomUUID()");
    });

    it("binds the name introduced by a TypeScript parameter property", async () => {
      const code = [
        `import { value } from "../server/secrets.ts";`,
        `export async function getServerData() { return value; }`,
        `export default class Page {`,
        `  constructor(private value = "client") { console.log(value); }`,
        `}`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "../server/secrets.ts");
      assertStringIncludes(result, 'value = "client"');
      assertStringIncludes(result, "console.log(value)");
    });

    it("does not hoist a static-block var into the enclosing function scope", async () => {
      const code = [
        `import { loadSecret } from "../server/secrets.ts";`,
        `export async function getServerData() { return loadSecret("server"); }`,
        `export default function Page() {`,
        `  class ClientValue { static { var loadSecret = "local"; } }`,
        `  return loadSecret("client") + ClientValue;`,
        `}`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "../server/secrets.ts");
      assertStringIncludes(result, 'loadSecret("client")');
      assertNotIncludes(result, 'loadSecret("server")');
    });

    it("keeps static-block var declarations scoped to that block", async () => {
      const code = [
        `import { loadSecret } from "../server/secrets.ts";`,
        `export async function getServerData() { return loadSecret("server"); }`,
        `export default class Page {`,
        `  static { console.log(loadSecret); var loadSecret = "local"; }`,
        `}`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "../server/secrets.ts");
      assertStringIncludes(result, 'var loadSecret = "local"');
      assertNotIncludes(result, 'loadSecret("server")');
    });

    // A pattern default is runtime code: a helper it references is part of the
    // dropped declarator's closure and is pruned with it once nothing else
    // reads it.
    it("prunes a helper referenced only from a dropped pattern default", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `function fallbackKey() { return getEnv("FALLBACK"); }`,
        `const { key = fallbackKey() } = getEnv("CFG");`,
        `export async function getServerData() { return { props: { key } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertEquals(occurrences(result, "key"), 0);
      assertEquals(occurrences(result, "fallbackKey"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    it("ignores reads between bindings in the same dropped pattern", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const { token, auth = token } = getEnv("CFG");`,
        `export async function getServerData() { return { props: { auth } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertEquals(occurrences(result, "token"), 0);
      assertEquals(occurrences(result, "auth"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
      assertNotIncludes(result, "CFG");
    });

    // Regression (review probe): a pattern default that reads a *sibling*
    // binding of the same pattern used to keep the declarator alive forever —
    // the self-referential read counted as an external consumer, so the
    // secret-bearing initialiser call and its import shipped silently even
    // though only the stripped hook read the bindings.
    it("drops a pattern whose default multiplies a sibling binding of the same pattern", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const { retries, delay = retries * 2 } = getEnv("SERVER_SECRET_CFG");`,
        `export async function getServerData() { return { props: { retries, delay } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertEquals(occurrences(result, "retries"), 0);
      assertEquals(occurrences(result, "delay"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
      assertNotIncludes(result, "SERVER_SECRET_CFG");
      assertNotIncludes(result, `"veryfront"`);
    });

    it("drops a chain that flows through a destructured server value", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const { raw } = getEnv("TOKEN");`,
        `const cleaned = raw.trim();`,
        `export async function getServerData() { return { props: { cleaned } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertEquals(occurrences(result, "raw"), 0);
      assertEquals(occurrences(result, "cleaned"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    // Regression (closed leak): liveness used to be decided one declaration at
    // a time — "is this name mentioned anywhere else?" — so two hook-only
    // helpers that call each other each counted as the other's consumer and
    // neither could ever be removed. The secret they closed over, and the
    // node-builtin import behind it, shipped to the browser. Liveness is now
    // reachability from the code that survives, and an unreachable cycle goes
    // whole however long it is.
    it("drops a cycle of hook-only helpers and the node builtin they shared", async () => {
      const code = [
        `import { createHash } from "node:crypto";`,
        `function normalize(row) { return row.id ? sign(row) : null; }`,
        `function sign(row) { return createHash("sha256").update(normalize(row) ?? "").digest("hex"); }`,
        `export async function getServerData() { return { props: { rows: [normalize({ id: 1 })] } }; }`,
        `export default function Page({ rows }) { return rows.length; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertEquals(occurrences(result, "normalize"), 0);
      assertEquals(occurrences(result, "sign"), 0);
      assertEquals(occurrences(result, "createHash"), 0);
      assertNotIncludes(result, "node:crypto");
    });

    it("drops a cycle of hook-only arrow bindings holding a secret", async () => {
      const code = [
        `const API_KEY = "sk-live-example";`,
        `const ping = (n) => n <= 0 ? API_KEY : pong(n - 1);`,
        `const pong = (n) => ping(n - 1);`,
        `export async function getServerData() { return { props: { k: ping(3) } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertEquals(occurrences(result, "API_KEY"), 0);
      assertEquals(occurrences(result, "ping"), 0);
      assertEquals(occurrences(result, "pong"), 0);
      assertNotIncludes(result, "sk-live-example");
    });

    it("drops a three-helper cycle reached only through the hook", async () => {
      const code = [
        `const API_KEY = "sk-live-example";`,
        `function first(n) { return n <= 0 ? API_KEY : second(n); }`,
        `function second(n) { return third(n - 1); }`,
        `function third(n) { return first(n - 1); }`,
        `export async function getServerData() { return { props: { k: first(3) } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "sk-live-example");
      assertEquals(occurrences(result, "first"), 0);
      assertEquals(occurrences(result, "second"), 0);
      assertEquals(occurrences(result, "third"), 0);
    });

    // Contrast pin: the same cycle survives whole the moment the client reaches
    // into any part of it.
    it("keeps a helper cycle the client still reaches", async () => {
      const code = [
        `function ping(n) { return n <= 0 ? 0 : pong(n - 1); }`,
        `function pong(n) { return ping(n - 1); }`,
        `export async function getServerData() { return { props: { k: ping(3) } }; }`,
        `export default function Page() { return pong(2); }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "function ping");
      assertStringIncludes(result, "function pong");
    });

    // Regression (closed leak): a `var` hoists into module scope out of any
    // block, `if`, `try`, `switch`, loop or label it is written in, but the
    // declaration collector only ever looked at direct top-level declarations.
    // A secret declared that way was never a removal candidate at all, so it
    // shipped whenever the statement around it was impure enough to survive on
    // its own.
    const hoistedVarSecrets: Array<[string, string]> = [
      ["a bare block", `{ var API_KEY = getEnv("SECRET_KEY"); }`],
      ["an if branch", `if (globalThis.cond) { var API_KEY = getEnv("SECRET_KEY"); }`],
      ["a labelled declaration", `setup: var API_KEY = getEnv("SECRET_KEY");`],
      [
        "a try/catch pair",
        `try { var API_KEY = getEnv("SECRET_KEY"); } catch (e) { var API_KEY = null; }`,
      ],
      [
        "a switch case",
        `switch (globalThis.mode) { case 1: var API_KEY = getEnv("SECRET_KEY"); }`,
      ],
      ["a for initialiser", `for (var API_KEY = getEnv("SECRET_KEY"); false;) {}`],
      [
        "a destructuring pattern",
        `if (globalThis.cond) { var { token: API_KEY } = getEnv("SECRET_KEY"); }`,
      ],
    ];

    for (const [description, declaration] of hoistedVarSecrets) {
      it(`drops a hook-only module-scope var declared in ${description}`, async () => {
        const code = [
          `import { getEnv } from "veryfront";`,
          declaration,
          `export async function getServerData() { return { props: { k: API_KEY } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code, "pages/x.tsx");

        assertEquals(occurrences(result, "API_KEY"), 0);
        assertNotIncludes(result, "SECRET_KEY");
        assertEquals(occurrences(result, "getEnv"), 0);
      });
    }

    // Contrast pin: the same nested declaration stays the moment client code
    // reads it, and so does the statement it lives in.
    it("keeps a nested-block module-scope var the client reads", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `if (globalThis.cond) { var REGION = getEnv("REGION"); }`,
        `export async function getServerData() { return { props: { r: REGION } }; }`,
        `export default function Page() { return REGION; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "REGION");
      assertStringIncludes(result, "getEnv");
    });

    // A `for…of` head declares the binding the loop assigns to, so there is no
    // declaration to cut out and the value the loop iterates would stay either
    // way. The build stops rather than shipping it.
    it("fails the build when a dead server-only var is declared by a for-of head", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `for (var API_KEY of [getEnv("SECRET_KEY")]) { globalThis.seen = true; }`,
        `export async function getServerData() { return { props: { k: API_KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() => stripServerOnlyExports(code, "pages/x.tsx"));

      assertStringIncludes((error as Error).message, "API_KEY");
    });

    // A `var` can be written down twice for the same module binding. Dropping
    // only the dead declaration would leave the name bound by the other one, so
    // the pass refuses to take out half a binding and stops the build instead.
    it("fails the build when only one declaration of a repeated var is dead", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `var API_KEY = getEnv("SECRET_KEY");`,
        `if (globalThis.cond) { var [API_KEY, shown] = getEnv("PAIR"); }`,
        `export async function getServerData() { return { props: { k: API_KEY } }; }`,
        `export default function Page() { return shown; }`,
      ].join("\n");

      const error = await assertRejects(() => stripServerOnlyExports(code, "pages/x.tsx"));

      assertStringIncludes((error as Error).message, "API_KEY");
      assertStringIncludes((error as Error).message, "declared more than once");
    });

    // Regression (closed leak): a statement label lives in its own namespace,
    // but the scan read `break API_KEY` as a reference to the module's
    // `API_KEY` and kept the secret alive forever. The label itself is client
    // code and stays; the declaration it merely shares a spelling with does not.
    it("does not count a statement label as a reference", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const API_KEY = getEnv("SECRET_KEY");`,
        `export async function getServerData() { return { props: { k: API_KEY } }; }`,
        `export default function Page() {`,
        `  API_KEY: for (let i = 0; i < 1; i++) { break API_KEY; }`,
        `  return null;`,
        `}`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "SECRET_KEY");
      assertEquals(occurrences(result, "getEnv"), 0);
      assertStringIncludes(result, "break API_KEY");
    });

    // The *exported* half of an export specifier is a name this module
    // publishes, not a read of anything it declares.
    it("does not count an export alias's exported name as a reference", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const API_KEY = getEnv("SECRET_KEY");`,
        `export async function getServerData() { return { props: { k: API_KEY } }; }`,
        `const other = 1;`,
        `export { other as API_KEY };`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "SECRET_KEY");
      assertEquals(occurrences(result, "getEnv"), 0);
      assertStringIncludes(result, "other as API_KEY");
    });

    // A decorator is ordinary code in a position the scan skipped entirely, so
    // a value only the hook's decorator read stayed behind with its import.
    it("tracks a decorator read inside a stripped hook", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const API_KEY = getEnv("SECRET_KEY");`,
        `export async function getServerData() {`,
        `  @API_KEY class Local {}`,
        `  return { props: { n: Local.name } };`,
        `}`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "page.tsx");

      assertEquals(occurrences(result, "API_KEY"), 0);
      assertNotIncludes(result, "SECRET_KEY");
    });

    it("keeps a value a decorator on client code reads", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const REGION = getEnv("REGION");`,
        `function withRegion(value) { return (target) => target; }`,
        `@withRegion(REGION) class Widget {}`,
        `export async function getServerData() { return { props: { r: REGION } }; }`,
        `export default function Page() { return Widget; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "page.tsx");

      assertStringIncludes(result, "REGION");
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

    it("keeps side effects for ordinary imports with mixed hook-only bindings", async () => {
      const code = [
        `import { initClient, loadSecret } from "./client-setup.ts";`,
        `export async function getServerData() { return { props: { token: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `import "./client-setup.ts"`);
      assertEquals(occurrences(result, "initClient"), 0);
      assertEquals(occurrences(result, "loadSecret"), 0);
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

    it("does not count a lowercase JSX tag as a binding reference", async () => {
      const code = [
        `import { secret } from "../server/secrets.ts";`,
        `export async function getServerData() { return secret(); }`,
        `export default function Page() { return <secret />; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "page.tsx");

      assertStringIncludes(result, "<secret />");
      assertNotIncludes(result, "../server/secrets.ts");
      assertEquals(occurrences(result, "secret"), 1);
    });

    it("counts a lowercase JSX member root as a binding reference", async () => {
      const code = [
        `import client from "../components/client.tsx";`,
        `export async function getServerData() { return { props: {} }; }`,
        `export default function Page() { return <client.Icon />; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "page.tsx");

      assertStringIncludes(result, 'client from "../components/client.tsx"');
      assertStringIncludes(result, "<client.Icon />");
    });

    it("does not count a JSX namespace name as a binding reference", async () => {
      const code = [
        `import { svg } from "../server/icons.ts";`,
        `export async function getServerData() { return svg; }`,
        `export default function Page() { return <svg:path />; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "page.tsx");

      assertStringIncludes(result, "<svg:path />");
      assertNotIncludes(result, "../server/icons.ts");
      assertEquals(occurrences(result, "svg"), 1);
    });

    it("does not count a JSX attribute name as a reference", async () => {
      const code = [
        `import { secret } from "../server/secrets.ts";`,
        `export async function getServerData() { return secret(); }`,
        `export default function Page() { return <div secret="public" />; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "page.tsx");

      assertStringIncludes(result, 'secret="public"');
      assertNotIncludes(result, "../server/secrets.ts");
      assertEquals(occurrences(result, "secret"), 1);
    });

    it("reads the object but not the property of a JSX member expression", async () => {
      const code = [
        `import Client from "../components/Client.tsx";`,
        `import { Icon } from "../server/icons.ts";`,
        `export async function getServerData() { return Icon; }`,
        `export default function Page() { return <Client.Icon />; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "page.tsx");

      assertStringIncludes(result, 'Client from "../components/Client.tsx"');
      assertStringIncludes(result, "<Client.Icon />");
      assertNotIncludes(result, "../server/icons.ts");
    });

    it("does not count import.meta names as binding references", async () => {
      const code = [
        `import { meta } from "../server/meta.ts";`,
        `export async function getServerData() { return meta; }`,
        `export default function Page() { return import.meta.url; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "import.meta.url");
      assertNotIncludes(result, "../server/meta.ts");
      assertEquals(occurrences(result, "meta"), 1);
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

  // A dead declaration must not be able to vouch for a secret. These are the
  // shapes where it still could: an initialiser that only *looks* impure, and
  // one that runs but reads the secret somewhere that never runs with it.
  describe("what a dead declaration can pin", () => {
    // Choosing between two values, or comparing them without coercion, calls
    // nothing. Each of these used to be "not proven inert", so the dead
    // declaration counted as a top-level side effect and rooted the secret.
    const inertOperators: Array<[string, string]> = [
      ["a conditional", `const dead = MARK ? KEY : MARK;`],
      ["a logical or", `const dead = KEY || MARK;`],
      ["a nullish coalesce", `const dead = KEY ?? MARK;`],
      ["a logical and", `const dead = KEY && MARK;`],
      ["a strict comparison", `const dead = KEY === MARK;`],
      ["a strict inequality", `const dead = KEY !== MARK;`],
      ["a sequence", `const dead = (MARK, KEY);`],
    ];

    for (const [description, declaration] of inertOperators) {
      it(`drops a hook-only secret ${description} reads in a dead declaration`, async () => {
        const code = [
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SECRET_KEY");`,
          `const MARK = "client-mark";`,
          declaration,
          `export async function getServerData() { return { props: { k: KEY } }; }`,
          `export default function Page() { return MARK; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code);

        assertNotIncludes(result, "SECRET_KEY");
        assertEquals(occurrences(result, "KEY"), 0);
        assertEquals(occurrences(result, "dead"), 0);
        assertStringIncludes(result, "client-mark");
      });
    }

    // Coercion is the line: `==`, `<` and arithmetic all reach `valueOf`, so
    // the comparison is a real read of the secret and the declaration stays.
    it("keeps a hook-only secret a coercing comparison reads in a dead declaration", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const dead = KEY > 1;`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "SECRET_KEY");
    });

    // Naming a superclass reads its `prototype`, which can invoke a Proxy trap
    // even when the heritage expression is a plain binding. The pass cannot
    // delete that evaluation or retain the secret in the deferred method.
    it("fails closed for a dead class that extends a local client class", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `class Base { b() { return "client-mark"; } }`,
        `const KEY = getEnv("SECRET_KEY");`,
        `class Dead extends Base { m() { return KEY; } }`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return new Base().b(); }`,
      ].join("\n");

      const error = await assertRejects(() => stripServerOnlyExports(code, "pages/leak.tsx"));

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "pages/leak.tsx");
    });

    it("fails closed instead of deleting a dead subclass's heritage evaluation", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `import Base from "./client-base.ts";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `class Dead extends Base { m() { return KEY; } }`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() => stripServerOnlyExports(code, "pages/leak.tsx"));

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "pages/leak.tsx");
    });

    // A body that never runs is not a read. `memo(…)` is a genuine top-level
    // side effect, so the declaration stays, but the arrow it is handed only
    // reads the secret if something calls it — and nothing reaches `handler`.
    // The pass can neither drop the surviving call nor honestly claim the
    // secret is gone, so it stops the build.
    it("fails the build when a secret is read only from an unreachable declaration's body", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `import { memo } from "./memo.ts";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const handler = memo(() => KEY);`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() => stripServerOnlyExports(code, "pages/leak.tsx"));

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "pages/leak.tsx");
    });

    it("fails the build when a deferred parameter default is the last secret reader", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `import { memo } from "./memo.ts";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const handler = memo((value = KEY) => value);`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() => stripServerOnlyExports(code, "pages/leak.tsx"));

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "pages/leak.tsx");
    });

    it("fails closed for a deferred callback in a root-only statement", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `import { memo } from "./memo.ts";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `memo(() => KEY);`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-callback.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-callback.tsx");
    });

    it("keeps a secret read by a root-only IIFE", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(function () { globalThis.registered = KEY; })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/root-iife.tsx");

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "globalThis.registered = KEY");
    });

    it("does not run a direct IIFE body when an argument can throw", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `((value) => { globalThis.registered = KEY; })(missing);`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-argument.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-argument.tsx");
    });

    it("does not evaluate arguments after a direct IIFE argument can throw", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `((first, second) => {})(missing, KEY);`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-later-argument.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-later-argument.tsx");
    });

    it("does not evaluate a sequence tail inside an aborting call argument", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `((value) => {})((missing, KEY));`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-argument-sequence.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-argument-sequence.tsx");
    });

    it("does not evaluate a pattern default after parameter conversion aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(({ x = KEY }) => {})();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-pattern-default.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-pattern-default.tsx");
    });

    it("does not evaluate a default skipped by a defined argument", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `((value = KEY) => {})(1);`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-skipped-default.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-skipped-default.tsx");
    });

    it("does not evaluate a sequence tail inside an aborting default", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `((value = (missing, KEY)) => {})();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-default-sequence.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-default-sequence.tsx");
    });

    it("does not evaluate statements after an unconditional IIFE throw", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { throw new Error("stop"); globalThis.registered = KEY; })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-after-throw.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-after-throw.tsx");
    });

    it("does not evaluate a throw operand tail after its prefix aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { throw (missing, KEY); })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-throw-operand.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-throw-operand.tsx");
    });

    it("does not evaluate a return operand tail after its prefix aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { return (missing, KEY); })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-return-operand.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-return-operand.tsx");
    });

    it("does not evaluate constructor arguments after callee resolution aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { throw new missing(KEY); })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-constructor-callee.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-constructor-callee.tsx");
    });

    it("does not evaluate statements after an unproven IIFE statement", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { missing; globalThis.registered = KEY; })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-after-unproven.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-after-unproven.tsx");
    });

    it("does not evaluate declarators after an earlier initializer aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { const first = missing, second = KEY; })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-declarator-order.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-declarator-order.tsx");
    });

    it("does not evaluate an if branch after its test aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { if (missing) globalThis.registered = KEY; })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-if-test.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-if-test.tsx");
    });

    it("does not evaluate an unreachable branch of a constant if test", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { if (false) globalThis.registered = KEY; })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-if-constant.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-if-constant.tsx");
    });

    it("does not evaluate a nested block tail after an unconditional throw", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { if (true) { throw 0; globalThis.registered = KEY; } })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-if-block.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-if-block.tsx");
    });

    it("does not enter a while body after its test aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { while (missing) { globalThis.registered = KEY; } })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-while-test.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-while-test.tsx");
    });

    it("does not enter a while body when its test is statically false", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { while (false) { globalThis.registered = KEY; } })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-while-false.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-while-false.tsx");
    });

    it("analyzes a while body when its test is statically true", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { while (true) { missing; globalThis.registered = KEY; } })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-while-true.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-while-true.tsx");
    });

    it("continues after a local break from a statically true while loop", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { while (true) { break; } globalThis.registered = KEY; })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/root-iife-while-break.tsx");

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "globalThis.registered = KEY");
    });

    it("analyzes the first body iteration of an unconditional for loop", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { for (;;) { missing; globalThis.registered = KEY; } })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-for-true.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-for-true.tsx");
    });

    it("does not evaluate a do-while test after its body aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { do { missing; } while (KEY); })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-do-while.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-do-while.tsx");
    });

    it("does not enter a for body after its test aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { for (; missing;) { globalThis.registered = KEY; } })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-for-test.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-for-test.tsx");
    });

    it("does not evaluate switch cases after its discriminant aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { switch (missing) { case 0: globalThis.registered = KEY; } })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-switch-test.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-switch-test.tsx");
    });

    it("does not evaluate switch cases after an earlier case test aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { switch (0) { case missing: break; case KEY: break; } })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-switch-case.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-switch-case.tsx");
    });

    it("does not evaluate case tests after a static switch match", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { switch (0) { case 0: break; case KEY: break; } })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-switch-match.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-switch-match.tsx");
    });

    it("does not evaluate consequents of statically unmatched switch cases", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { switch (1) { case 0: use(KEY); break; case 1: break; } })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-switch-mismatch.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-switch-mismatch.tsx");
    });

    it("analyzes the consequent selected by a static switch match", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { switch (1) { case 1: missing; globalThis.registered = KEY; } })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-switch-consequent.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-switch-consequent.tsx");
    });

    it("does not enter an earlier default when a later case matches", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { switch (1) { default: use(KEY); break; case 1: break; } })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-switch-default.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-switch-default.tsx");
    });

    it("analyzes a selected default after exhausting case tests", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { switch (1) { case 0: break; default: missing; use(KEY); } })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-switch-late-default.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-switch-late-default.tsx");
    });

    it("continues after a known switch has no matching case or default", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { switch (1) { case 0: break; } globalThis.registered = KEY; })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/root-iife-switch-no-match.tsx");

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "globalThis.registered = KEY");
    });

    it("analyzes the default consequent when no case matches", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { switch (1) { default: missing; use(KEY); case 0: break; } })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-switch-selected-default.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes(
        (error as Error).message,
        "root-iife-switch-selected-default.tsx",
      );
    });

    it("does not consume a labeled break in an inner loop", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { outer: { while (true) { break outer; } globalThis.registered = KEY; } })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-labeled-break.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-labeled-break.tsx");
    });

    it("analyzes both branches of an inert nonconstant if test", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const cond = globalThis.flag;`,
        `(() => { if (cond) { missing; use(KEY); } })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-if-branches.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-if-branches.tsx");
    });

    it("analyzes possible switch consequents for an inert nonconstant discriminant", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const cond = globalThis.flag;`,
        `(() => { switch (cond) { case 1: missing; globalThis.registered = KEY; } })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-switch-possible-consequent.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes(
        (error as Error).message,
        "root-iife-switch-possible-consequent.tsx",
      );
    });

    it("analyzes possible case consequents with a known switch discriminant", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const cond = globalThis.flag;`,
        `(() => { switch (1) { case cond: missing; globalThis.registered = KEY; } })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-switch-possible-case.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes(
        (error as Error).message,
        "root-iife-switch-possible-case.tsx",
      );
    });

    it("does not fall through after a possible switch case breaks", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const cond = globalThis.flag;`,
        `(() => { switch (1) { case cond: break; case 0: globalThis.registered = KEY; } })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-switch-possible-break.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes(
        (error as Error).message,
        "root-iife-switch-possible-break.tsx",
      );
    });

    it("does not trust fallthrough after an unproven possible case consequent", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const cond = globalThis.flag;`,
        `(() => { switch (1) { case cond: maybe(); case 0: globalThis.registered = KEY; } })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-switch-possible-unknown.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes(
        (error as Error).message,
        "root-iife-switch-possible-unknown.tsx",
      );
    });

    it("stops possible fallthrough at an abrupt mismatched case", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const cond = globalThis.flag;`,
        `(() => { switch (1) { case cond: case 0: break; case -1: globalThis.registered = KEY; } })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-switch-mismatch-break.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes(
        (error as Error).message,
        "root-iife-switch-mismatch-break.tsx",
      );
    });

    it("stops possible fallthrough at an abrupt default", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const cond = globalThis.flag;`,
        `(() => { switch (1) { case cond: default: break; case 0: globalThis.registered = KEY; } })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-switch-default-break.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes(
        (error as Error).message,
        "root-iife-switch-default-break.tsx",
      );
    });

    it("keeps code reached when an earlier possible switch case breaks", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const cond = globalThis.flag;`,
        `(() => { switch (1) { case cond: break; case 1: return; } globalThis.registered = KEY; })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(
        code,
        "pages/root-iife-switch-possible-break-exit.tsx",
      );

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "globalThis.registered = KEY");
    });

    it("does not evaluate a try-block tail after its prefix aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { try { missing; globalThis.registered = KEY; } finally {} })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-try-prefix.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-try-prefix.tsx");
    });

    it("does not enter a catch after a return from the try block", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { try { return; } catch { globalThis.registered = KEY; } })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-return-catch.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-return-catch.tsx");
    });

    it("continues after a caught throw when the handler completes", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { try { throw 0; } catch {} globalThis.registered = KEY; })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/root-iife-caught-throw.tsx");

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "globalThis.registered = KEY");
    });

    it("enters a catch when evaluating a return operand throws", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { try { return missing; } catch { globalThis.registered = KEY; } })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/root-iife-return-throw.tsx");

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "globalThis.registered = KEY");
    });

    it("does not evaluate a labeled block tail after its prefix aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => { label: { missing; globalThis.registered = KEY; } })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-labeled-prefix.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-labeled-prefix.tsx");
    });

    it("does not evaluate an await operand tail after its prefix aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(async () => { await (missing, KEY); })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-await-operand.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-await-operand.tsx");
    });

    it("does not evaluate a nested pattern default after destructuring aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(({ x = KEY } = {}) => {})(null);`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-nested-pattern.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-nested-pattern.tsx");
    });

    it("keeps a secret read by an inline tagged-template function", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `((strings) => { globalThis.registered = KEY; })\`value\`;`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/root-tagged-function.tsx");

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "globalThis.registered = KEY");
    });

    it("keeps a secret read by an immediately invoked object method", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `({ run() { globalThis.registered = KEY; } }).run();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/root-object-method.tsx");

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "globalThis.registered = KEY");
    });

    it("keeps a secret read by an invoked object method with an inert sibling", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `({ tag: 1, run() { globalThis.registered = KEY; } }).run();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/root-object-sibling.tsx");

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "globalThis.registered = KEY");
    });

    it("does not evaluate object properties after an earlier initializer aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `({ first: missing, second: KEY, run() {} }).run();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-object-later-property.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-object-later-property.tsx");
    });

    it("does not evaluate an object value after its computed key aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `({ [missing]: KEY, run() {} }).run();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-object-computed-key.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-object-computed-key.tsx");
    });

    it("does not evaluate a computed-key tail after its prefix aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `({ [missing + KEY]: 0, run() {} }).run();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-object-computed-key-tail.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-object-computed-key-tail.tsx");
    });

    it("does not evaluate call arguments after a computed-key callee aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `({ [missing(KEY)]: 0, run() {} }).run();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-object-computed-call.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-object-computed-call.tsx");
    });

    it("keeps a secret read by a selected inline-object getter", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `({ get run() { globalThis.registered = KEY; return () => {}; } }).run();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/root-object-getter.tsx");

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "globalThis.registered = KEY");
    });

    it("does not evaluate call arguments after a selected getter aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `({ get run() { throw new Error("stop"); } }).run(KEY);`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-object-getter-argument-order.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-object-getter-argument-order.tsx");
    });

    it("evaluates call arguments after a selected getter completes", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `({ get run() { return 1; } }).run(KEY);`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(
        code,
        "pages/root-object-getter-completes.tsx",
      );

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, ").run(KEY)");
    });

    it("keeps a selected getter when a later setter completes the accessor", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `({ get run() { globalThis.registered = KEY; return () => {}; }, set run(value) {} }).run();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/root-object-accessor-pair.tsx");

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "globalThis.registered = KEY");
    });

    it("keeps a secret read by a function returned from a selected getter", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `({ get run() { return () => { globalThis.registered = KEY; }; } }).run();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/root-object-getter-result.tsx");

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "globalThis.registered = KEY");
    });

    it("keeps a secret read after simple returned-function parameter initialization", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `({ get run() { return (value) => { globalThis.registered = KEY; }; } }).run(1);`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/root-object-getter-param.tsx");

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "globalThis.registered = KEY");
    });

    it("keeps a getter-returned body called with an initialized identifier", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const value = 1;`,
        `({ get run() { return (arg) => { globalThis.registered = KEY; }; } }).run(value);`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(
        code,
        "pages/root-object-getter-identifier.tsx",
      );

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "globalThis.registered = KEY");
    });

    it("keeps a getter-returned body called with an initialized nested binding", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `(() => {`,
        `  const value = 1;`,
        `  ({ get run() { return (arg) => { globalThis.registered = KEY; }; } }).run(value);`,
        `})();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(
        code,
        "pages/root-object-getter-nested-identifier.tsx",
      );

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "globalThis.registered = KEY");
    });

    it("keeps a getter-returned body called with an initialized function parameter", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `((value) => {`,
        `  ({ get run() { return (arg) => { globalThis.registered = KEY; }; } }).run(value);`,
        `})(1);`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(
        code,
        "pages/root-object-getter-function-param.tsx",
      );

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "globalThis.registered = KEY");
    });

    it("initializes each parameter before evaluating the next default", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `((value = 1, ignored = ({ get run() {`,
        `  return (arg) => { globalThis.registered = KEY; };`,
        `} }).run(value)) => {})();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(
        code,
        "pages/root-object-getter-later-default.tsx",
      );

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "globalThis.registered = KEY");
    });

    it("keeps a getter-returned body called from a for-of body", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `for (const value of [1]) {`,
        `  ({ get run() { return (arg) => { globalThis.registered = KEY; }; } }).run(value);`,
        `}`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(
        code,
        "pages/root-object-getter-for-body.tsx",
      );

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "globalThis.registered = KEY");
    });

    it("keeps a getter-returned body after an inert default initializes", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `({ get run() { return (value = 1) => { globalThis.registered = KEY; }; } }).run();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/root-object-getter-default.tsx");

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "globalThis.registered = KEY");
    });

    it("initializes a named returned function before its parameter defaults", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `({ get run() {`,
        `  return function inner(value = inner) { globalThis.registered = KEY; };`,
        `} }).run();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(
        code,
        "pages/root-object-getter-named-function.tsx",
      );

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "globalThis.registered = KEY");
    });

    it("skips a getter-returned default after a defined literal argument", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `({ get run() { return (value = missing) => { globalThis.registered = KEY; }; } }).run(1);`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(
        code,
        "pages/root-object-getter-skipped-default.tsx",
      );

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "globalThis.registered = KEY");
    });

    it("does not run a getter-returned body after destructuring initialization aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `({ get run() { return ({ x }) => { globalThis.registered = KEY; }; } }).run();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-object-getter-pattern.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-object-getter-pattern.tsx");
    });

    it("does not confuse a parameter's own default TDZ with a module binding", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const value = 1;`,
        `({ get run() { return (value = value) => { globalThis.registered = KEY; }; } }).run();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-object-getter-param-tdz.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-object-getter-param-tdz.tsx");
    });

    it("does not treat a binding as initialized inside its own initializer", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const value = ({ get run() { return (arg) => { globalThis.registered = KEY; }; } }).run(value);`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-object-getter-call-tdz.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-object-getter-call-tdz.tsx");
    });

    it("does not bypass a nested self-TDZ with an outer module binding", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const value = 1;`,
        `(() => {`,
        `  const value = ({ get run() {`,
        `    return (arg) => { globalThis.registered = KEY; };`,
        `  } }).run(value);`,
        `})();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-object-getter-nested-tdz.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-object-getter-nested-tdz.tsx");
    });

    it("does not bypass a named class TDZ during heritage evaluation", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const value = 1;`,
        `const Derived = class value extends ({ get run() {`,
        `  return (arg) => { globalThis.registered = KEY; };`,
        `} }).run(value) {};`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-object-getter-class-tdz.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-object-getter-class-tdz.tsx");
    });

    it("keeps a for-of binding in the TDZ while evaluating its RHS", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const value = 1;`,
        `for (const value of ({ get run() {`,
        `  return (arg) => { globalThis.registered = KEY; return []; };`,
        `} }).run(value)) {}`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-object-getter-for-rhs-tdz.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-object-getter-for-rhs-tdz.tsx");
    });

    it("does not run a getter-returned body when a call argument can throw", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `({ get run() { return (value) => { globalThis.registered = KEY; }; } }).run(missing);`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-object-getter-argument.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-object-getter-argument.tsx");
    });

    it("keeps a secret read by an invoked object method with a numeric sibling key", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `({ 0: 1, run() { globalThis.registered = KEY; } }).run();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/root-object-numeric-sibling.tsx");

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "globalThis.registered = KEY");
    });

    it("does not invoke a selected inline-object setter", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `({ set run(value) { globalThis.registered = KEY; } }).run();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-object-setter.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-object-setter.tsx");
    });

    it("does not preserve a method overwritten by a later setter", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `({ run() { globalThis.registered = KEY; }, set run(value) {} }).run();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-object-method-setter.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-object-method-setter.tsx");
    });

    it("does not invoke an object method past an unresolved sibling initializer", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `({ tag: missing, run() { globalThis.registered = KEY; } }).run();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-object-effectful-sibling.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-object-effectful-sibling.tsx");
    });

    it("does not invoke an overwritten object method", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `({ run() { globalThis.registered = KEY; }, run: 1 }).run();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-object-overwritten-method.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-object-overwritten-method.tsx");
    });

    it("keeps a secret read by an immediately invoked function-valued property", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `({ run: () => { globalThis.registered = KEY; } }).run();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/root-object-property.tsx");

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "globalThis.registered = KEY");
    });

    it("keeps a secret read by an optionally invoked inline object method", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `({ run() { globalThis.registered = KEY; } }).run?.();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/root-optional-method.tsx");

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "globalThis.registered = KEY");
    });

    it("fails the build when a called generator defers the last secret read", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const dead = (function* () { yield KEY; })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() => stripServerOnlyExports(code, "pages/leak.tsx"));

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "pages/leak.tsx");
    });

    for (
      const [description, member] of [
        ["constructor", `constructor() { globalThis.constructed = KEY; }`],
        ["instance field", `field = KEY;`],
      ] as const
    ) {
      it(`keeps a secret read by an inline class ${description}`, async () => {
        const code = [
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SECRET_KEY");`,
          `const instance = new class { ${member} };`,
          `export async function getServerData() { return { props: { k: KEY } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code, "pages/inline-class.tsx");

        assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
        assertStringIncludes(result, "new class");
        assertStringIncludes(result, 'throw new Error("server-only")');
      });
    }

    it("does not construct an inline class when an argument can throw", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { field = KEY; }(missing);`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-class-argument.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "inline-class-argument.tsx");
    });

    it("does not run instance fields after an earlier initializer aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { first = missing; second = KEY; }();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-class-field-order.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "inline-class-field-order.tsx");
    });

    it("does not evaluate a sequence tail after a field initializer aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { first = (missing, KEY); }();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-class-field-sequence.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "inline-class-field-sequence.tsx");
    });

    it("does not evaluate array elements after a field initializer aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { first = [missing, KEY]; }();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-class-field-array.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "inline-class-field-array.tsx");
    });

    it("does not evaluate a spread operand tail after its prefix aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { first = [...(missing, KEY)]; }();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-class-field-spread.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "inline-class-field-spread.tsx");
    });

    it("does not evaluate a unary operand tail after its prefix aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { first = !(missing, KEY); }();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-class-field-unary.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "inline-class-field-unary.tsx");
    });

    it("does not evaluate JSX attributes after an earlier attribute aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { first = <div a={missing} b={KEY} />; }();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-class-field-jsx.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "inline-class-field-jsx.tsx");
    });

    it("does not evaluate JSX attributes after tag resolution aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { first = <missing.Component value={KEY} />; }();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-class-field-jsx-tag.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "inline-class-field-jsx-tag.tsx");
    });

    it("does not evaluate JSX attributes after an initialized member tag lookup aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const Components = { get Broken() { throw 0; } };`,
        `(() => { <Components.Broken value={KEY} />; })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-jsx-member-tag.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-jsx-member-tag.tsx");
    });

    it("does not evaluate a binary right operand after its left side aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { first = missing + KEY; }();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-class-field-binary.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "inline-class-field-binary.tsx");
    });

    it("does not evaluate an assignment value after its member target aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { first = missing.value = KEY; }();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-class-field-assignment.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "inline-class-field-assignment.tsx");
    });

    it("analyzes an assignment value after its member target completes", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { first = globalThis.value = (missing, KEY); }();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-class-field-assignment-value.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "inline-class-field-assignment-value.tsx");
    });

    it("analyzes RHS values for simple identifier assignments", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `let target;`,
        `(() => { target = (missing, KEY); })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-iife-assignment-rhs.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-iife-assignment-rhs.tsx");
    });

    it("analyzes both ternary branches for an inert nonconstant test", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const cond = globalThis.flag;`,
        `globalThis.value = cond ? (missing, KEY) : 0;`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/root-ternary-branches.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "root-ternary-branches.tsx");
    });

    it("does not evaluate a compound assignment value after its member target aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { first = missing.value += KEY; }();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-class-field-compound-assignment.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes(
        (error as Error).message,
        "inline-class-field-compound-assignment.tsx",
      );
    });

    it("does not evaluate object properties after an earlier value aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { first = ({ first: missing, second: KEY }); }();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-class-field-object-order.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "inline-class-field-object-order.tsx");
    });

    it("does not evaluate an object value after its computed key aborts in a field", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { first = ({ [missing]: KEY }); }();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-class-field-object-key.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "inline-class-field-object-key.tsx");
    });

    it("does not evaluate template substitutions after an earlier one aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        "const instance = new class { first = `${missing}${KEY}`; }();",
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-class-field-template.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "inline-class-field-template.tsx");
    });

    it("does not evaluate tagged-template substitutions after tag resolution aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        "const instance = new class { first = missing`${KEY}`; }();",
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-class-field-tagged-template.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "inline-class-field-tagged-template.tsx");
    });

    it("does not evaluate a logical right operand after its left side aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { first = missing && KEY; }();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-class-field-logical.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "inline-class-field-logical.tsx");
    });

    it("does not evaluate a short-circuited logical right operand", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { first = false && KEY; }();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-class-field-short-circuit.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "inline-class-field-short-circuit.tsx");
    });

    it("does not evaluate a short-circuited logical operand after BigInt zero", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { first = 0n && KEY; }();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-class-field-bigint.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "inline-class-field-bigint.tsx");
    });

    it("does not evaluate arguments of a statically skipped optional call", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { first = null?.(KEY); }();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-class-field-optional-call.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "inline-class-field-optional-call.tsx");
    });

    it("does not evaluate a computed key on a statically skipped optional member", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { first = null?.[KEY]; }();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-class-field-optional-member.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "inline-class-field-optional-member.tsx");
    });

    it("does not evaluate conditional branches after the test aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { first = missing ? KEY : 0; }();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-class-field-conditional.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "inline-class-field-conditional.tsx");
    });

    it("does not evaluate a constructor default skipped by a defined argument", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { constructor(value = KEY) {} }(1);`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-class-constructor-default.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "inline-class-constructor-default.tsx");
    });

    it("does not initialize derived fields after a constructor default aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class extends class {} {`,
        `  field = KEY;`,
        `  constructor(value = missing) { super(); }`,
        `}();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-class-derived-default.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "inline-class-derived-default.tsx");
    });

    it("does not run direct instance fields when class definition throws", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { static value = missing; field = KEY; };`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/throwing-inline-class-definition.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "throwing-inline-class-definition.tsx");
    });

    it("does not evaluate a static initializer tail after its prefix aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `class Value { static first = (missing, KEY); }`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/throwing-static-initializer-tail.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "throwing-static-initializer-tail.tsx");
    });

    it("does not evaluate a static block tail after its prefix aborts", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `class Value { static { missing; globalThis.registered = KEY; } }`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/throwing-static-block-tail.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "throwing-static-block-tail.tsx");
    });

    it("does not evaluate a logical operand after a false unary primitive", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { static field = !true && KEY; }();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/static-unary-logical.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "static-unary-logical.tsx");
    });

    it("does not evaluate a logical operand after a void primitive", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { static field = void 0 && KEY; }();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/static-void-logical.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "static-void-logical.tsx");
    });

    it("keeps a logical operand reached after safe numeric unary primitives", async () => {
      for (const [name, unary] of [["plus", "+1"], ["minus", "-1"]]) {
        const code = [
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SECRET_KEY");`,
          `const instance = new class { static field = ${unary} && KEY; }();`,
          `export async function getServerData() { return { props: { k: KEY } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code, `pages/static-unary-${name}.tsx`);

        assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
        assertStringIncludes(result, `${unary} && KEY`);
      }
    });

    it("does not run static elements after static initialization throws", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class {`,
        `  static { throw new Error("stop"); }`,
        `  static value = KEY;`,
        `};`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/throwing-static-prefix.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "throwing-static-prefix.tsx");
    });

    it("does not run a static initializer when its computed key throws", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { static [missing] = KEY; };`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/throwing-static-key.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "throwing-static-key.tsx");
    });

    it("keeps a static initializer behind a harmless computed key", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { static ["value"] = KEY; };`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/harmless-static-key.tsx");

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, `["value"] = KEY`);
    });

    it("keeps a static field after harmless static initialization", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { static first = 1; static value = KEY; };`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/harmless-static-prefix.tsx");

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "static value = KEY");
    });

    it("keeps an uncalled inline class method deferred", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class { method() { return KEY; } };`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-class-method.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "pages/inline-class-method.tsx");
    });

    it("keeps a secret read by an inline superclass instance field", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class extends class { field = KEY; } {};`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/inline-superclass.tsx");

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "new class extends class");
      assertStringIncludes(result, 'throw new Error("server-only")');
    });

    it("does not trust a nested inline superclass with nonconstructable heritage", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class extends (class extends null {}) { field = KEY; };`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/nested-nonconstructable-superclass.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "nested-nonconstructable-superclass.tsx");
    });

    it("does not assume a throwing function superclass completes construction", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class extends function () { throw new Error("stop"); } {`,
        `  field = KEY;`,
        `};`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/throwing-function-superclass.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "throwing-function-superclass.tsx");
    });

    it("does not assume a throwing inline class constructor completes", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class extends class {`,
        `  constructor() { throw new Error("stop"); }`,
        `} { field = KEY; };`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/throwing-class-superclass.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "throwing-class-superclass.tsx");
    });

    it("does not assume an inline superclass field initializer completes", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class extends class { base = missing; } { field = KEY; };`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/throwing-superclass-field.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "throwing-superclass-field.tsx");
    });

    it("does not assume inline superclass static initialization completes", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class extends class { static value = missing; } { field = KEY; };`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/throwing-superclass-static.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "throwing-superclass-static.tsx");
    });

    it("keeps a field initialized after a harmless superclass field", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class extends class { base = 1; } { field = KEY; };`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/harmless-superclass-field.tsx");

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, 'throw new Error("server-only")');
    });

    it("keeps a field initialized after harmless superclass static initialization", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class extends class { static value = 1; } { field = KEY; };`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/harmless-superclass-static.tsx");

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, 'throw new Error("server-only")');
    });

    it("keeps a field initialized after an empty function superclass returns", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class extends function () {} { field = KEY; };`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/empty-function-superclass.tsx");

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, 'throw new Error("server-only")');
    });

    for (
      const [description, heritage, path] of [
        [
          "satisfies",
          `((class {}) satisfies abstract new () => object)`,
          "pages/satisfies-superclass.tsx",
        ],
        [
          "type assertion",
          `(<abstract new () => object>(class {}))`,
          "pages/type-assertion-superclass.ts",
        ],
      ] as const
    ) {
      it(`unwraps a ${description} around a constructable inline superclass`, async () => {
        const code = [
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SECRET_KEY");`,
          `const instance = new class extends ${heritage} { field = KEY; };`,
          `export async function getServerData() { return { props: { k: KEY } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code, path);

        assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
        assertStringIncludes(result, 'throw new Error("server-only")');
      });
    }

    it("does not assume an explicit derived constructor invokes its inline base", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class extends class { field = KEY; } {`,
        `  constructor() { return {}; }`,
        `};`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/explicit-derived-constructor.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "explicit-derived-constructor.tsx");
    });

    it("does not assume fields run before an explicit derived constructor returns", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class extends class {} {`,
        `  field = KEY;`,
        `  constructor() { return {}; }`,
        `};`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/explicit-derived-field.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "explicit-derived-field.tsx");
    });

    it("keeps fields run by an explicit derived constructor that begins with super", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class extends class {} {`,
        `  field = KEY;`,
        `  constructor() { super(); }`,
        `};`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/explicit-super.tsx");

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "super();");
      assertStringIncludes(result, 'throw new Error("server-only")');
    });

    it("keeps fields run after inert arguments to an initial super call", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class extends class {} {`,
        `  field = KEY;`,
        `  constructor() { super(1); }`,
        `};`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/explicit-super-argument.tsx");

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "super(1);");
      assertStringIncludes(result, 'throw new Error("server-only")');
    });

    it("does not run fields when an initial super argument can throw", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class extends class {} {`,
        `  field = KEY;`,
        `  constructor() { super(missing); }`,
        `};`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/explicit-effectful-super-argument.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "explicit-effectful-super-argument.tsx");
    });

    for (
      const [description, heritage] of [
        ["null", "null"],
        ["an arrow", "(() => {})"],
      ] as const
    ) {
      it(`does not assume ${description} superclass can initialize fields`, async () => {
        const code = [
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SECRET_KEY");`,
          `const instance = new class extends ${heritage} { field = KEY; };`,
          `export async function getServerData() { return { props: { k: KEY } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const error = await assertRejects(() =>
          stripServerOnlyExports(code, "pages/nonconstructable-superclass.tsx")
        );

        assertStringIncludes((error as Error).message, "KEY");
        assertStringIncludes((error as Error).message, "nonconstructable-superclass.tsx");
      });
    }

    it("does not treat a called class literal as constructed", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = (class { field = KEY; })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/called-class-literal.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "called-class-literal.tsx");
    });

    it("does not treat a constructed arrow literal as invoked", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new (() => KEY)();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/constructed-arrow-literal.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "constructed-arrow-literal.tsx");
    });

    it("keeps an uncalled inline superclass method deferred", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const instance = new class extends class { method() { return KEY; } } {};`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "pages/inline-superclass-method.tsx")
      );

      assertStringIncludes((error as Error).message, "KEY");
      assertStringIncludes((error as Error).message, "pages/inline-superclass-method.tsx");
    });

    // Contrast pin: the same shape is ordinary client code the moment the
    // browser can reach the declaration, and then the secret it closes over is
    // shared state this pass must leave alone.
    it("keeps a secret read from the body of a declaration the client reaches", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `import { memo } from "./memo.ts";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const handler = memo(() => KEY);`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return handler(); }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "SECRET_KEY");
      assertStringIncludes(result, "handler");
    });

    it("keeps a hook-owned binding read by surviving module code", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function register(value) { globalThis.registered = value; }`,
        `register(KEY);`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "SECRET_KEY");
      assertStringIncludes(result, "register(KEY)");
    });

    it("keeps a hook-owned binding reached through a separate default export", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `function Page() { return KEY; }`,
        `export { Page as default };`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "SECRET_KEY");
      assertStringIncludes(result, "Page as default");
    });

    it("keeps a hook-owned binding reached through a direct default export", async () => {
      const code = [
        `import { forwardRef } from "react";`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const Page = forwardRef(() => KEY);`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default Page;`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "forwardRef(() => KEY)");
      assertStringIncludes(result, "export default Page");
    });

    it("keeps a hook-owned binding reached through a default export expression", async () => {
      const code = [
        `import { memo } from "react";`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default memo(() => KEY);`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "export default memo(() => KEY)");
    });

    it("keeps bindings selected by a conditional default export", async () => {
      const code = [
        `import { forwardRef } from "react";`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const Page = forwardRef(() => KEY);`,
        `const Fallback = () => null;`,
        `const flag = globalThis.usePage;`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default (flag ? Page : Fallback);`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "forwardRef(() => KEY)");
      assertStringIncludes(result, "flag ? Page : Fallback");
    });

    it("keeps a hook-owned binding read by an anonymous default function", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function () { return KEY; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      assertStringIncludes(result, "export default function");
      assertStringIncludes(result, "return KEY");
    });

    // An immediately invoked function is not deferred: its body runs where it
    // is written, so the secret it reads is genuinely read at module load.
    it("keeps a secret an immediately invoked initialiser reads", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `const dead = (function () { globalThis.x = KEY; return 1; })();`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "SECRET_KEY");
    });

    for (
      const [method, args] of [
        ["call", "null"],
        ["apply", "null, []"],
      ] as const
    ) {
      it(`keeps a module-evaluation read from a bracketed ${method} IIFE`, async () => {
        const code = [
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SECRET_KEY");`,
          `const ran = (function () { globalThis.registered = KEY; return true; })["${method}"](${args});`,
          `export async function getServerData() { return { props: { k: KEY } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code);

        assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
        assertStringIncludes(result, `["${method}"](${args})`);
        assertStringIncludes(result, `throw new Error("server-only")`);
        assertNotIncludes(result, "props:");
      });
    }

    // Over-pruning guard for the hoisted-`var` exception: eliding the site from
    // the roots stops it pinning a hook-only import, but the call is still the
    // module's own side effect. When the binding it calls survives — because
    // browser code calls it too — removing the statement would silently delete
    // working client code.
    it("keeps a hoisted var whose initialiser calls an import the client also uses", async () => {
      const code = [
        `import { boot } from "./boot.ts";`,
        `if (globalThis.debug) { var dead = boot("dev-only-mark"); }`,
        `export async function getServerData() { return { props: { b: boot("server") } }; }`,
        `export default function Page() { return boot("client"); }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "dev-only-mark");
      assertStringIncludes(result, "./boot.ts");
      assertStringIncludes(result, `boot("client")`);
    });

    it("keeps a hoisted var that mixes live and hook-only calls", async () => {
      const code = [
        `import { boot, loadSecret } from "./boot.ts";`,
        `if (globalThis.debug) { var dead = boot(loadSecret("dev-only-mark")); }`,
        `export async function getServerData() {`,
        `  return { props: { b: boot("server"), k: loadSecret("server") } };`,
        `}`,
        `export default function Page() { return boot("client"); }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/leak.tsx");

      assertStringIncludes(result, "dev-only-mark");
      assertStringIncludes(result, "loadSecret");
      assertStringIncludes(result, `boot("client")`);
      assertStringIncludes(result, "./boot.ts");
    });
  });

  describe("plugin", () => {
    function ctx(code: string, target: "browser" | "ssr"): TransformContext {
      return { code, target, filePath: "pages/test.tsx", metadata: new Map() } as TransformContext;
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

    it("does not retain a pre-strip inline source map", async () => {
      const source = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SERVER_VALUE");`,
        `const CLIENT_MARKER = "//# sourceMappingURL=data:text/plain;base64,AAAA";`,
        `export async function getServerData() { return { props: { key: KEY } }; }`,
        `export default function Page() { return CLIENT_MARKER; }`,
      ].join("\n");
      const compileContext = {
        ...ctx(source, "browser"),
        dev: true,
        jsxImportSource: "react",
      };
      const compiled = await compilePlugin.transform(compileContext);
      const directive = compileContext.metadata.get(COMPILE_SOURCE_MAP_DIRECTIVE_METADATA);
      assertEquals(typeof directive, "string");
      const match = String(directive).match(
        /\/\/[#@]\s*sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/]+={0,2})/,
      );
      assertEquals(match === null, false);
      const sourceMap = JSON.parse(atob(match?.[1] ?? "")) as {
        sourcesContent?: string[];
      };
      assertEquals(
        sourceMap.sourcesContent?.some((content) => content.includes("SERVER_VALUE")),
        true,
      );

      const result = await browserServerExportsStripPlugin.transform({
        ...compileContext,
        code: compiled,
      });

      assertNotIncludes(result, "SERVER_VALUE");
      assertNotIncludes(result, "sourceMappingURL=data:application/json;base64,");
      assertStringIncludes(result, "sourceMappingURL=data:text/plain;base64,AAAA");
    });

    it("removes a pre-strip inline map before an appended MDX export", async () => {
      const source = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SERVER_VALUE");`,
        `const CLIENT_MARKER = "//# sourceMappingURL=data:text/plain;base64,AAAA";`,
        `const MDXLayout = () => CLIENT_MARKER;`,
        `export async function getServerData() { return { props: { key: KEY } }; }`,
      ].join("\n");
      const compileContext = {
        ...ctx(source, "browser"),
        filePath: "pages/test.mdx",
        dev: true,
        jsxImportSource: "react",
      };
      const compiled = await compilePlugin.transform(compileContext);
      assertEquals(
        String(compileContext.metadata.get(COMPILE_SOURCE_MAP_DIRECTIVE_METADATA)).includes(
          "sourceMappingURL=data:application/json;base64,",
        ),
        true,
      );
      assertNotIncludes(compiled, "sourceMappingURL=data:application/json;base64,");
      assertStringIncludes(compiled, "export { MDXLayout };");

      const result = await browserServerExportsStripPlugin.transform({
        ...compileContext,
        code: compiled,
      });

      assertNotIncludes(result, "SERVER_VALUE");
      assertNotIncludes(result, "sourceMappingURL=data:application/json;base64,");
      assertStringIncludes(result, "sourceMappingURL=data:text/plain;base64,AAAA");
      assertStringIncludes(result, "export { MDXLayout };");
    });

    it("removes the compile map after an intermediate plugin appends code", async () => {
      const source = [
        `const KEY = "SERVER_ONLY_HOOK_SOURCE";`,
        `export async function getServerData() { return { props: { key: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await runPipeline(
        source,
        "/project/pages/test.tsx",
        "/project",
        { projectId: "source-map-intermediate-plugin", dev: true, ssr: false },
        {
          plugins: [{
            name: "append-after-compile",
            stage: TransformStage.COMPILE + 0.5,
            transform: (ctx) => `${ctx.code}\nexport const APPENDED = true;`,
          }],
        },
      );

      assertNotIncludes(result.code, "SERVER_ONLY_HOOK_SOURCE");
      assertNotIncludes(result.code, "sourceMappingURL=data:application/json;base64,");
      assertStringIncludes(result.code, "export const APPENDED = true;");
    });

    it("does not confuse a copied map string with the compile map comment", async () => {
      const source = [
        `const KEY = "SERVER_ONLY_HOOK_SOURCE";`,
        `export async function getServerData() { return { props: { key: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await runPipeline(
        source,
        "/project/pages/test.tsx",
        "/project",
        { projectId: "source-map-duplicate-text", dev: true, ssr: false },
        {
          plugins: [{
            name: "copy-map-before-appending",
            stage: TransformStage.COMPILE + 0.5,
            transform: (ctx) => {
              const directive = ctx.code.match(
                /\/\/[#@]\s*sourceMappingURL=data:application\/json;base64,[A-Za-z0-9+/]+={0,2}/,
              )?.[0];
              const copied = directive
                ? `export const COPIED_COMPILE_MAP = ${JSON.stringify(directive)};\n`
                : "";
              return `${copied}${ctx.code}\nexport const APPENDED = true;`;
            },
          }],
        },
      );

      assertNotIncludes(result.code, "SERVER_ONLY_HOOK_SOURCE");
      assertNotIncludes(result.code, "sourceMappingURL=data:application/json;base64,");
      assertNotIncludes(result.code, "COPIED_COMPILE_MAP");
      assertStringIncludes(result.code, "export const APPENDED = true;");
    });

    it("does not restore a compile map after an intermediate plugin removes the hook", async () => {
      const source = [
        `const KEY = "SERVER_ONLY_HOOK_SOURCE";`,
        `export async function getServerData() { return { props: { key: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await runPipeline(
        source,
        "/project/pages/test.tsx",
        "/project",
        { projectId: "source-map-intermediate-removal", dev: true, ssr: false },
        {
          plugins: [{
            name: "remove-server-hook",
            stage: TransformStage.COMPILE + 0.5,
            transform: () => `export default function Page() { return null; }`,
          }],
        },
      );

      assertNotIncludes(result.code, "SERVER_ONLY_HOOK_SOURCE");
      assertNotIncludes(result.code, "sourceMappingURL=data:application/json;base64,");
      assertStringIncludes(result.code, "export default function Page()");
    });

    it("keeps the compile map when no server hook or intermediate change exists", async () => {
      const result = await runPipeline(
        `export default function Page() { return null; }`,
        "/project/pages/test.tsx",
        "/project",
        { projectId: "source-map-no-server-hook", dev: true, ssr: false },
      );

      assertStringIncludes(result.code, "sourceMappingURL=data:application/json;base64,");
    });

    it("removes an external source map reference after stripping", async () => {
      const code = [
        `export function getStaticData() { return readSecret(); }`,
        `export default function Page() { return null; }`,
        `//# sourceMappingURL=page.js.map`,
      ].join("\n");

      const result = await browserServerExportsStripPlugin.transform(ctx(code, "browser"));

      assertNotIncludes(result, "readSecret");
      assertNotIncludes(result, "sourceMappingURL=page.js.map");
    });

    it("does not run for the ssr target", () => {
      assertEquals(browserServerExportsStripPlugin.condition?.(ctx("", "ssr")), false);
      assertEquals(browserServerExportsStripPlugin.condition?.(ctx("", "browser")), true);
    });
  });

  // Everything above hands this stage source as the author wrote it. In the real
  // browser pipeline esbuild runs first, and it rewrites the module's export
  // shape: every named export is hoisted into one trailing `export { … }` clause
  // and the declarations are left bare. That difference is not cosmetic — it is
  // the only form in which the export contract reaches this stage, and a rule
  // keyed on `export`-wrapped declarations silently does nothing here. These
  // cases compile first, so a regression that only shows up after esbuild
  // cannot pass unnoticed.
  describe("compiled input", () => {
    afterAll(async () => {
      await stopEsbuild();
    });

    function ctx(code: string, filePath: string): TransformContext {
      return {
        code,
        originalSource: code,
        filePath,
        projectDir: "/project",
        projectId: "project",
        target: "browser",
        dev: true,
        contentHash: "hash",
        jsxImportSource: "react",
        timing: new Map(),
        debug: false,
        metadata: new Map(),
        reactVersion: "19.1.1",
      } as TransformContext;
    }

    /** The real browser pipeline: esbuild, then this stage. */
    async function compileThenStrip(source: string, filePath: string): Promise<string> {
      const compiled = await compilePlugin.transform!(ctx(source, filePath));
      return await stripServerOnlyExports(compiled, filePath);
    }

    it("keeps an exported client value that shares a binding with the hook", async () => {
      const source = [
        `import { getEnv } from "veryfront";`,
        `import { makeClient } from "@/lib/client";`,
        `const API_KEY = getEnv("API_KEY");`,
        `export const client = makeClient({ get: () => API_KEY });`,
        `export async function getServerData() { return { props: { k: API_KEY } }; }`,
      ].join("\n");

      const result = await compileThenStrip(source, "/project/app/page.tsx");

      // `client` is exported, so the browser reaches `API_KEY` through it. The
      // honest outcome is to keep both, not to fail the build over a value the
      // module deliberately publishes.
      assertStringIncludes(result, "const client = makeClient");
      assertStringIncludes(result, `const API_KEY = getEnv("API_KEY")`);
      assertStringIncludes(result, `throw new Error("server-only")`);
      assertNotIncludes(result, "props:");
    });

    it("keeps a forwardRef component that defers a read of the hook's binding", async () => {
      const source = [
        `import { forwardRef } from "react";`,
        `import { getEnv } from "veryfront";`,
        `const TOKEN = getEnv("INPUT_BOX_TOKEN");`,
        `export const InputBox = forwardRef(function InputBox(props, ref) {`,
        `  return <input ref={ref} data-token={TOKEN} {...props} />;`,
        `});`,
        `export async function getServerData() { return { props: { t: TOKEN } }; }`,
      ].join("\n");

      const result = await compileThenStrip(source, "/project/react/primitives/input-box.tsx");

      // Nothing in the module calls `InputBox` — its only consumer is the export
      // clause esbuild emitted, which is exactly the edge that used to be missed.
      assertStringIncludes(result, "forwardRef(");
      assertStringIncludes(result, `const TOKEN = getEnv("INPUT_BOX_TOKEN")`);
      assertStringIncludes(result, "InputBox");
      assertStringIncludes(result, `throw new Error("server-only")`);
    });

    it("still drops a hook-only secret and its import from compiled output", async () => {
      const source = [
        `import { getEnv } from "veryfront";`,
        `const API_KEY = getEnv("API_KEY");`,
        `function readKey() { return API_KEY; }`,
        `export async function getServerData() { return { props: { k: readKey() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await compileThenStrip(source, "/project/app/page.tsx");

      // Rooting the export clause must not turn this stage into a no-op: nothing
      // exported reaches `API_KEY`, so it and its import still go.
      assertEquals(occurrences(result, "API_KEY"), 0);
      assertEquals(occurrences(result, "readKey"), 0);
      assertNotIncludes(result, `from "veryfront"`);
      assertStringIncludes(result, "Page as default");
    });

    it("does not root a re-exported name as a local binding", async () => {
      const source = [
        `import { getEnv } from "veryfront";`,
        `export { helper } from "@/lib/helper";`,
        `const API_KEY = getEnv("API_KEY");`,
        `function helper2() { return API_KEY; }`,
        `export async function getServerData() { return { props: { k: helper2() } }; }`,
      ].join("\n");

      const result = await compileThenStrip(source, "/project/app/page.tsx");

      // `export { helper } from "…"` names no binding this module declares, so it
      // must not keep a same-named local alive.
      assertEquals(occurrences(result, "API_KEY"), 0);
      assertEquals(occurrences(result, "helper2"), 0);
      assertStringIncludes(result, "@/lib/helper");
    });

    for (
      const [method, args] of [
        ["call", "null"],
        ["apply", "null, []"],
      ] as const
    ) {
      it(`keeps a module-evaluation read from a function-expression .${method} IIFE`, async () => {
        const source = [
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SERVER_VALUE");`,
          `const ran = (function () { globalThis.registered = KEY; return true; }).${method}(${args});`,
          `export async function getServerData() { return { props: { k: KEY } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await compileThenStrip(source, "/project/app/page.tsx");

        assertStringIncludes(result, `const KEY = getEnv("SERVER_VALUE")`);
        assertStringIncludes(result, `.${method}(${args})`);
        assertStringIncludes(result, `throw new Error("server-only")`);
        assertNotIncludes(result, "props:");
      });
    }
  });

  describe("remediation advice", () => {
    it("tells the author to separate the value, not to re-declare the hook", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `import { makeClient } from "@/lib/client";`,
        `const API_KEY = getEnv("API_KEY");`,
        `const client = makeClient({ get: () => API_KEY });`,
        `export async function getServerData() { return { props: { k: API_KEY } }; }`,
      ].join("\n");

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "/project/app/page.tsx")
      );
      const { message } = error as Error;

      // The hook here *is* declared directly, so repeating that advice was noise
      // covering up the only thing the author can actually act on.
      assertStringIncludes(message, "still reads it from a body that runs only when");
      assertStringIncludes(message, "Move the shared value into a module the hook imports");
      assertNotIncludes(message, "Declare the hook directly");
    });

    it("still tells the author to declare a re-exported hook directly", async () => {
      const code = `export { loadIt as getServerData } from "./loader.ts";`;

      const error = await assertRejects(() =>
        stripServerOnlyExports(code, "/project/app/page.tsx")
      );

      assertStringIncludes((error as Error).message, "Declare the hook directly");
    });
  });

  describe("TypeScript reference classification", () => {
    /**
     * Both walkers' answers restricted to `names`, so a fixture asserts which
     * module-level bindings each one attributes to runtime code without
     * listing every local it also sees.
     */
    async function referencesAmong(
      code: string,
      names: string[],
      filePath = "page.tsx",
    ): Promise<{ referenced: string[]; free: string[] }> {
      const parser = tryResolve<CodeParser>("CodeParser");
      if (!parser) throw new Error("no CodeParser extension is registered");
      const ast = await parser.parse({ code, filePath });
      const { referenced, free } = moduleReferenceWalkers(ast);
      const pick = (found: Set<string>) => names.filter((name) => found.has(name));
      return { referenced: pick(referenced), free: pick(free) };
    }

    /**
     * The defect this classification fixes is the two walkers disagreeing, so
     * every fixture asserts the same expectation against both.
     */
    async function assertWalkers(
      code: string,
      names: string[],
      expected: string[],
    ): Promise<void> {
      const { referenced, free } = await referencesAmong(code, names);
      assertEquals(referenced, expected, "referencedIdentifiers");
      assertEquals(free, expected, "freeReferencedIdentifiers");
    }

    describe("erased type positions do not reference a binding", () => {
      it("ignores `typeof` in a parameter type annotation", async () => {
        await assertWalkers(
          [
            `import { KEY, used } from "./server.ts";`,
            `export default function Page(p: { k: typeof KEY }) { return used(p); }`,
          ].join("\n"),
          ["KEY", "used"],
          ["used"],
        );
      });

      it("ignores a type alias over `ReturnType<typeof loadUser>`", async () => {
        await assertWalkers(
          [
            `import { loadUser, render } from "./server.ts";`,
            `type User = ReturnType<typeof loadUser>;`,
            `export default function Page(u: User) { return render(u); }`,
          ].join("\n"),
          ["loadUser", "render"],
          ["render"],
        );
      });

      it("ignores an interface member type", async () => {
        await assertWalkers(
          `import { Loader, run } from "./server.ts";
interface Shape { l: Loader; m(a: Loader): Loader }
export default function Page() { return run(); }`,
          ["Loader", "run"],
          ["run"],
        );
      });

      it("ignores the type operand of `as` and `satisfies` but keeps the value", async () => {
        await assertWalkers(
          `import { Cast, raw, SAT } from "./server.ts";
export const a = raw as Cast;
export const b = raw satisfies typeof SAT;`,
          ["Cast", "raw", "SAT"],
          ["raw"],
        );
      });

      it("ignores heritage clauses in a type position", async () => {
        await assertWalkers(
          `import { Iface, Base, Mixin } from "./server.ts";
interface Derived extends Base<Iface> { x: number }
export class Page extends Mixin implements Iface {}`,
          ["Iface", "Base", "Mixin"],
          ["Mixin"],
        );
      });

      it("ignores type parameters and type arguments", async () => {
        await assertWalkers(
          `import { Bound, TArg, call } from "./server.ts";
export function f<T extends Bound>(x: T) { return call<TArg>(x); }`,
          ["Bound", "TArg", "call"],
          ["call"],
        );
      });

      it("ignores type-only import and export specifiers", async () => {
        await assertWalkers(
          `import { hashOf, type Cfg } from "./server.ts";
import type { Only } from "./types.ts";
export type { Cfg };
export { type Only };
export const h = hashOf("x");`,
          ["hashOf", "Cfg", "Only"],
          ["hashOf"],
        );
      });

      it("ignores `declare` forms and declared function signatures", async () => {
        await assertWalkers(
          `import { Amb, live } from "./server.ts";
declare const ambient: Amb;
declare function ambientFn(a: Amb): Amb;
declare class Ambient extends Amb {}
export const v = live();`,
          ["Amb", "live"],
          ["live"],
        );
      });

      it("keeps a decorator on a declared property, which still emits a runtime call", async () => {
        // `@audit declare id: string` is ambient in the type system, but tsc and
        // esbuild both emit a `__decorate` call for it, so the decorator is a
        // real read. Erasing it deleted the import the call needs and produced a
        // ReferenceError at browser module evaluation.
        const code = [
          'import { audit } from "./audit.ts";',
          'import { getEnv } from "veryfront";',
          'const KEY = getEnv("SECRET");',
          "export async function getServerData() { return { props: { k: KEY } }; }",
          "class Model {",
          "  @audit declare id: string;",
          "}",
          "export default function Page() { return null; }",
        ].join("\n");

        const result = await stripServerOnlyExports(code, "/project/app/page.tsx");

        // The NAMED binding must survive: the emitted `__decorate` call reads
        // `audit` by name. Asserting only on the specifier would pass even when
        // the import is demoted to a bare side-effect import, which is the bug.
        assertStringIncludes(result, "{ audit }");
        assertNotIncludes(result, 'getEnv("SECRET")');
      });

      it("still erases an undecorated declared property", async () => {
        const code = [
          'import { audit } from "./audit.ts";',
          'import { getEnv } from "veryfront";',
          'const KEY = getEnv("SECRET");',
          "export async function getServerData() { return { props: { k: KEY } }; }",
          "class Model {",
          "  declare id: string;",
          "}",
          "export default function Page() { return null; }",
        ].join("\n");

        const result = await stripServerOnlyExports(code, "/project/app/page.tsx");

        // The binding goes; the module specifier is demoted to a side-effect
        // import by dropUnusedImportBindings, which is pre-existing behaviour
        // and not what this case is about.
        assertNotIncludes(result, "{ audit }");
        assertNotIncludes(result, 'getEnv("SECRET")');
      });

      it("ignores an ambient namespace but not its runtime sibling", async () => {
        await assertWalkers(
          `import { AMBIENT_ONLY, RUNTIME_ONLY } from "./server.ts";
declare namespace Ambient { const a: typeof AMBIENT_ONLY; }
namespace Runtime { export const b = RUNTIME_ONLY; }
export const used = Runtime.b;`,
          ["AMBIENT_ONLY", "RUNTIME_ONLY"],
          ["RUNTIME_ONLY"],
        );
      });
    });

    describe("value-emitting TypeScript nodes do reference a binding", () => {
      it("keeps an enum member initialiser", async () => {
        await assertWalkers(
          `import { compute, SEED } from "./server.ts";
export enum Level { Low = compute(SEED) }`,
          ["compute", "SEED"],
          ["compute", "SEED"],
        );
      });

      it("binds enum member names while walking their initialisers", async () => {
        // `Both = Read` names a preceding MEMBER, not module scope. Without an
        // enum-member scope the pass reported `Read` as free, pulled the
        // unrelated `const Read = boot()` into the hook closure, and deleted it
        // together with its side-effectful import.
        const code = [
          'import { boot } from "./boot.ts";',
          "const Read = boot();",
          "export async function getServerData() {",
          "  enum Access { Read = 1, Both = Read }",
          "  return { props: { a: Access.Both } };",
          "}",
          "export default function Page() { return null; }",
        ].join("\n");

        const result = await stripServerOnlyExports(code, "/project/app/page.tsx");

        assertStringIncludes(result, "const Read = boot()");
        assertStringIncludes(result, "./boot.ts");
      });

      it("does not hoist a block-scoped enum into the enclosing function scope", async () => {
        // An enum nested in a block is block scoped: TypeScript emits `let` there.
        // Hoisting it into the function scope made the outer `consume(Alias)` read
        // look shadowed, so import liveness reduced the named import to a bare
        // side-effect import and left `client` with an unresolved binding.
        const code = [
          'import { Alias, secret } from "./lib.ts";',
          "export async function getServerData() { return { props: { s: secret } }; }",
          "export function client() {",
          "  consume(Alias);",
          "  if (false) { enum Alias { X } }",
          "}",
          "declare function consume(v: unknown): void;",
          "export default function Page() { client(); return null; }",
        ].join("\n");

        const result = await stripServerOnlyExports(code, "/project/app/page.tsx");

        assertStringIncludes(result, "import { Alias");
      });

      it("still reduces an import a same-scope enum genuinely shadows", async () => {
        // Paired with the case above: asserting only that the import survives
        // would also pass if the pass stopped reducing imports altogether.
        const code = [
          'import { Alias, secret } from "./lib.ts";',
          "export async function getServerData() { return { props: { s: secret } }; }",
          "export function client() {",
          "  enum Alias { X }",
          "  consume(Alias);",
          "}",
          "declare function consume(v: unknown): void;",
          "export default function Page() { client(); return null; }",
        ].join("\n");

        const result = await stripServerOnlyExports(code, "/project/app/page.tsx");

        assertNotIncludes(result, "import { Alias");
      });

      it("still strips a module binding an enum initialiser genuinely reads", async () => {
        // No member is named `Read` here, so `Read` really is a module-scope
        // read owned only by the hook and must still be removed.
        const code = [
          'import { boot } from "./boot.ts";',
          "const Read = boot();",
          "export async function getServerData() {",
          "  enum Access { X = 1 }",
          "  return { props: { a: Access.X, r: Read } };",
          "}",
          "export default function Page() { return null; }",
        ].join("\n");

        const result = await stripServerOnlyExports(code, "/project/app/page.tsx");

        assertNotIncludes(result, "const Read = boot()");
      });

      it("keeps a runtime namespace body", async () => {
        await assertWalkers(
          `import { NSREF } from "./server.ts";
export namespace Runtime { export const value = NSREF; }`,
          ["NSREF"],
          ["NSREF"],
        );
      });

      it("keeps a parameter property default", async () => {
        await assertWalkers(
          `import { Dep, DEFAULT_DEP } from "./server.ts";
export class Service { constructor(private readonly dep: Dep = DEFAULT_DEP) {} }`,
          ["Dep", "DEFAULT_DEP"],
          ["DEFAULT_DEP"],
        );
      });

      it("keeps an import-equals alias target", async () => {
        await assertWalkers(
          `import { NS } from "./server.ts";
import Alias = NS.Sub;
export const v = Alias;`,
          ["NS"],
          ["NS"],
        );
      });

      it("keeps an export assignment operand", async () => {
        await assertWalkers(
          `import { handler } from "./server.ts";
export = handler;`,
          ["handler"],
          ["handler"],
        );
      });

      it("keeps an `accessor` field initialiser", async () => {
        await assertWalkers(
          `import { ACCESSOR_INIT } from "./server.ts";
export class Page { accessor field = ACCESSOR_INIT; }`,
          ["ACCESSOR_INIT"],
          ["ACCESSOR_INIT"],
        );
      });

      it("keeps decorator arguments on a class and on its members", async () => {
        await assertWalkers(
          `import { decorate, CLASS_TOKEN, inject, MEMBER_TOKEN, METHOD_TOKEN } from "./server.ts";
@decorate(CLASS_TOKEN)
export class Page {
  @inject(MEMBER_TOKEN) field = 1;
  @inject(METHOD_TOKEN) method() { return 1; }
}`,
          ["decorate", "CLASS_TOKEN", "inject", "MEMBER_TOKEN", "METHOD_TOKEN"],
          ["decorate", "CLASS_TOKEN", "inject", "MEMBER_TOKEN", "METHOD_TOKEN"],
        );
      });

      it("keeps the value side of `as`, `satisfies`, `!` and instantiation", async () => {
        await assertWalkers(
          `import { raw, maybe, generic, TArg } from "./server.ts";
export const a = raw as unknown;
export const b = maybe!;
export const c = generic<TArg>;`,
          ["raw", "maybe", "generic", "TArg"],
          ["raw", "maybe", "generic"],
        );
      });

      it("treats runtime TypeScript declaration names as bindings, not reads", async () => {
        // The flat walker remains conservative for module-declaration
        // liveness, but enum declaration and member IDs are fixed names, not
        // reads. Import liveness uses the scope-aware walker. That walker must
        // report none of the local names, because its answer also grows the
        // hook dependency closure and can delete an unrelated declaration.
        const { referenced, free } = await referencesAmong(
          `import { Level, Low, Runtime, Alias } from "./server.ts";
export function hook() {
  enum Level { Low = 1 }
  namespace Runtime { export const v = 1; }
  return Level.Low;
}`,
          ["Level", "Low", "Runtime", "Alias"],
        );

        assertEquals(free, []);
        assertEquals(referenced, ["Level", "Runtime"]);
      });
    });

    describe("stripping authored TypeScript source", () => {
      it("drops a hook-only import referenced only from a type position", async () => {
        const code = [
          `import { hashOf } from "../lib/server-only.ts";`,
          `export async function getServerData() {`,
          `  return { props: { h: hashOf("x") } };`,
          `}`,
          `export default function Page(p: { k: typeof hashOf }) { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code, "page.tsx");

        assertNotIncludes(result, "server-only.ts");
      });

      it("deletes a mixed value and type import instead of reducing it", async () => {
        const code = [
          `import { hashOf, type Cfg } from "../lib/server-only.ts";`,
          `export function getServerData(): { props: { c: Cfg } } {`,
          `  return { props: { c: hashOf() } };`,
          `}`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code, "page.tsx");

        assertNotIncludes(result, "server-only.ts");
      });

      it("keeps an import an enum member initialiser still reads", async () => {
        const code = [
          `import { SEED } from "../lib/shared.ts";`,
          `export function getServerData() { return { props: { s: SEED } }; }`,
          `export enum Level { Low = SEED }`,
          `export default function Page() { return Level.Low; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code, "page.tsx");

        assertStringIncludes(result, "shared.ts");
        assertStringIncludes(result, "SEED");
      });

      it("keeps a module-scope binding a runtime namespace still reads", async () => {
        const code = [
          `import { makeToken } from "../lib/shared.ts";`,
          `const TOKEN = makeToken();`,
          `export function getServerData() { return { props: { t: TOKEN } }; }`,
          `export namespace Config { export const value = TOKEN; }`,
          `export default function Page() { return Config.value; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code, "page.tsx");

        assertStringIncludes(result, "const TOKEN = makeToken()");
      });

      it("keeps an import a parameter property default still reads", async () => {
        const code = [
          `import { DEFAULT_DEP } from "../lib/shared.ts";`,
          `export function getServerData() { return { props: { d: DEFAULT_DEP } }; }`,
          `export class Service { constructor(public dep = DEFAULT_DEP) {} }`,
          `export default function Page() { return new Service().dep; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code, "page.tsx");

        assertStringIncludes(result, "shared.ts");
        assertStringIncludes(result, "DEFAULT_DEP");
      });

      it("does not keep an import binding whose name matches an enum member", async () => {
        const code = [
          `import { secretOnly, Low } from "../lib/server-only.ts";`,
          `export function getServerData() { return { props: { s: secretOnly } }; }`,
          `export enum Level { Low = 1 }`,
          `export default function Page() { return Level.Low; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code, "page.tsx");

        assertNotIncludes(result, "{ secretOnly, Low }");
        // A mixed project import keeps its pre-existing side-effect contract.
        // The TypeScript fix removes the false live binding; it does not prove
        // that evaluating the imported module is safe to delete.
        assertStringIncludes(result, `import "../lib/server-only.ts"`);
        assertStringIncludes(result, "Level.Low");
      });

      it("keeps an import read after a static block shadows its name", async () => {
        const code = [
          `import { token } from "../lib/client.ts";`,
          `function local() { return "cache"; }`,
          `export class Cache { static { const token = local(); } }`,
          `export function getServerData() { return { props: { token } }; }`,
          `export default function Page() { return token; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code, "page.tsx");

        assertStringIncludes(result, `{ token }`);
        assertStringIncludes(result, `return token`);
      });

      it("keeps an import that matches a nested namespace segment", async () => {
        const code = [
          `import { B } from "../lib/client.ts";`,
          `export namespace A.B { export const value = 1; }`,
          `export function getServerData() { return { props: { b: B } }; }`,
          `export default function Page() { return B; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code, "page.tsx");

        assertStringIncludes(result, `{ B }`);
        assertStringIncludes(result, `return B`);
      });

      it("drops a hook-only binding shadowed by a surviving enum member", async () => {
        const code = [
          `import { getEnv } from "veryfront";`,
          `const Read = getEnv("SECRET_KEY");`,
          `export enum Access { Read = 1, Both = Read }`,
          `export function getServerData() { return { props: { r: Read } }; }`,
          `export default function Page() { return Access.Both; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code, "page.tsx");

        assertNotIncludes(result, "SECRET_KEY");
        assertNotIncludes(result, "const Read =");
        assertStringIncludes(result, "Both = Read");
      });

      it("keeps a module binding shadowed by a hoisted namespace var", async () => {
        const code = [
          `import { boot } from "../lib/analytics.ts";`,
          `const token = boot();`,
          `export function getServerData() {`,
          `  namespace N { consume(token); if (false) { var token = 1; } }`,
          `  return { props: {} };`,
          `}`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code, "page.tsx");

        assertStringIncludes(result, "const token = boot()");
        assertStringIncludes(result, "analytics.ts");
      });

      it("does not keep an import shadowed by a hoisted namespace alias", async () => {
        const code = [
          `import { secretOnly, Alias } from "../lib/server-only.ts";`,
          `export namespace M {`,
          `  queue(() => Alias.x);`,
          `  import Alias = ClientNS;`,
          `}`,
          `export function getServerData() { return { props: { s: secretOnly } }; }`,
          `export default function Page() { return M; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code, "page.tsx");

        assertNotIncludes(result, "{ secretOnly, Alias }");
        assertStringIncludes(result, `import "../lib/server-only.ts"`);
        assertStringIncludes(result, "import Alias = ClientNS");
      });

      it("drops a hook-only binding that matches a qualified-name property", async () => {
        const code = [
          `import { getEnv } from "veryfront";`,
          `const Sub = getEnv("SECRET_KEY");`,
          `import Alias = ClientNS.Sub;`,
          `export function getServerData() { return { props: { s: Sub } }; }`,
          `export default function Page() { return Alias; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code, "page.tsx");

        assertNotIncludes(result, "SECRET_KEY");
        assertNotIncludes(result, "const Sub =");
        assertStringIncludes(result, "ClientNS.Sub");
      });

      it("does not keep an import shadowed by a namespace-local enum", async () => {
        const code = [
          `import { secretOnly, Alias } from "../lib/server-only.ts";`,
          `export namespace M {`,
          `  queue(() => Alias);`,
          `  enum Alias { X }`,
          `}`,
          `export function getServerData() { return { props: { s: secretOnly } }; }`,
          `export default function Page() { return M; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code, "page.tsx");

        assertNotIncludes(result, "{ secretOnly, Alias }");
        assertStringIncludes(result, `import "../lib/server-only.ts"`);
        assertStringIncludes(result, "enum Alias");
      });

      it("keeps a declaration whose name matches a hook-local enum member", async () => {
        const code = [
          `import { boot } from "../lib/analytics.ts";`,
          `const Low = boot();`,
          `export function getServerData() {`,
          `  enum Level { Low = 1 }`,
          `  return { props: { l: Level.Low } };`,
          `}`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code, "page.tsx");

        assertStringIncludes(result, "const Low = boot()");
        assertStringIncludes(result, "analytics.ts");
      });
    });
  });
});
