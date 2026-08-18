import "#veryfront/schemas/_test-setup.ts";
import "../../plugins/__tests__/code-parser-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import { stop as stopEsbuild } from "#veryfront/platform/compat/esbuild.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  browserServerExportsStripPlugin,
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

      assertEquals(error instanceof VeryfrontError, true);
      assertEquals((error as VeryfrontError).slug, "server-export-strip-failed");
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
    // (and the loader module behind it) in the browser graph, so the build
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
    // was reported as exporting no hook and passed through byte for byte,
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
    // unconditionally live, including ones nothing calls. A private helper the
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
    // the module makes, so neither may turn a dead declaration into live code;
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

    it("does not treat a module-local Object.defineProperty call as compiler metadata", async () => {
      const code = [
        `const Object = {`,
        `  defineProperty(target, key, descriptor) {`,
        `    globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `    return target;`,
        `  },`,
        `};`,
        `var defineName = Object.defineProperty;`,
        `var setName = (target, value) => defineName(target, "name", { value, configurable: true });`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "globalThis.nameRegistrations");
      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("does not treat a dynamic Object property as compiler metadata", async () => {
      const code = [
        `const defineProperty = "seal";`,
        `var setName = (target, value) => Object[defineProperty](`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `defineProperty = "seal"`);
      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("does not treat an effectful name descriptor as compiler metadata", async () => {
      const code = [
        `function recordRegistration() {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return {};`,
        `}`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true, ...recordRegistration() },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "recordRegistration()");
      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("does not treat a reassigned defineProperty alias as compiler metadata", async () => {
      const code = [
        `var defineName = Object.defineProperty;`,
        `function recordAndReturn(target) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `defineName = recordAndReturn;`,
        `var setName = (target, value) => defineName(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "defineName = recordAndReturn");
      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("does not treat a reassigned name helper as compiler metadata", async () => {
      const code = [
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `function recordAndReturn(target) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `setName = recordAndReturn;`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "setName = recordAndReturn");
      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("ignores assignments to a lexically shadowed name helper", async () => {
      const code = [
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `function configure(setName) { setName = (target) => target; }`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "function configure(setName)");
      assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertEquals(occurrences(result, "KEY"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    it("keeps metadata when a nested assignment reaches the module helper", async () => {
      const code = [
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `function recordAndReturn(target) { return target; }`,
        `function configure() { setName = recordAndReturn; }`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "setName = recordAndReturn");
      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("does not treat a mutated Object.defineProperty as compiler metadata", async () => {
      const code = [
        `function recordAndReturn(target) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `Object.defineProperty = recordAndReturn;`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "Object.defineProperty = recordAndReturn");
      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("does not treat a redefined Object.defineProperty as compiler metadata", async () => {
      const code = [
        `function recordAndReturn(target) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `Object.defineProperty(Object, "defineProperty", { value: recordAndReturn });`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `Object.defineProperty(Object, "defineProperty"`);
      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("does not treat a multiply initialized name helper as compiler metadata", async () => {
      const code = [
        `function recordAndReturn(target) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `var setName = recordAndReturn;`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "globalThis.nameRegistrations");
      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("does not treat a multiply initialized intrinsic alias as compiler metadata", async () => {
      const code = [
        `function recordAndReturn(target) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `var defineName = recordAndReturn;`,
        `var setName = (target, value) => defineName(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `var defineName = Object.defineProperty;`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "globalThis.nameRegistrations");
      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("does not treat a reassigned global Object as compiler metadata", async () => {
      const code = [
        `function recordAndReturn(target) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `Object = { defineProperty: recordAndReturn };`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "Object = {");
      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("does not treat a helper with a local Object name as compiler metadata", async () => {
      const code = [
        `var setName = function Object(target, value) {`,
        `  return Object.defineProperty(target, "name", { value, configurable: true });`,
        `};`,
        `function recordAndReturn(target) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `setName.defineProperty = recordAndReturn;`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "setName.defineProperty = recordAndReturn");
      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("does not treat an aliased intrinsic as compiler metadata", async () => {
      const code = [
        `function recordAndReturn(target) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `const intrinsic = Object;`,
        `intrinsic.defineProperty = recordAndReturn;`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "intrinsic.defineProperty = recordAndReturn");
      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    for (
      const [label, mutation] of [
        [
          "a transitive intrinsic alias",
          [
            `const intrinsic = Object;`,
            `const alias = intrinsic;`,
            `alias.defineProperty = recordAndReturn;`,
          ].join("\n"),
        ],
        [
          "a nonliteral merge source",
          [
            `const patch = { Object: { defineProperty: recordAndReturn } };`,
            `Object.assign(globalThis, patch);`,
          ].join("\n"),
        ],
        [
          "an optional intrinsic mutation call",
          `Object.defineProperty?.(Object, "defineProperty", { value: recordAndReturn });`,
        ],
        [
          "a call-invoked intrinsic mutation",
          `(function (intrinsic) { intrinsic.defineProperty = recordAndReturn; }).call(null, Object);`,
        ],
        [
          "an apply-invoked intrinsic mutation",
          `(function (intrinsic) { intrinsic.defineProperty = recordAndReturn; }).apply(null, [Object]);`,
        ],
        [
          "a named-function intrinsic mutation",
          [
            `function mutateIntrinsic(intrinsic) {`,
            `  intrinsic.defineProperty = recordAndReturn;`,
            `}`,
            `mutateIntrinsic(Object);`,
          ].join("\n"),
        ],
        [
          "an invoked factory-returned function mutation",
          [
            `(function () {`,
            `  return function (intrinsic) {`,
            `    intrinsic.defineProperty = recordAndReturn;`,
            `  };`,
            `})()(Object);`,
          ].join("\n"),
        ],
        [
          "an invoked method-factory-returned function mutation",
          [
            `const factory = {`,
            `  make() {`,
            `    return function (intrinsic) {`,
            `      intrinsic.defineProperty = recordAndReturn;`,
            `    };`,
            `  },`,
            `};`,
            `factory.make()(Object);`,
          ].join("\n"),
        ],
        [
          "an assigned method-factory-returned function mutation",
          [
            `const factory = {};`,
            `factory.make = () => function (intrinsic) {`,
            `  intrinsic.defineProperty = recordAndReturn;`,
            `};`,
            `factory.make()(Object);`,
          ].join("\n"),
        ],
        [
          "an alias-assigned method-factory-returned function mutation",
          [
            `const factory = {};`,
            `const alias = factory;`,
            `alias.make = () => function (intrinsic) {`,
            `  intrinsic.defineProperty = recordAndReturn;`,
            `};`,
            `factory.make()(Object);`,
          ].join("\n"),
        ],
        [
          "a destructured-alias-assigned method-factory-returned function mutation",
          [
            `const factory = {};`,
            `const [alias] = [factory];`,
            `alias.make = () => function (intrinsic) {`,
            `  intrinsic.defineProperty = recordAndReturn;`,
            `};`,
            `factory.make()(Object);`,
          ].join("\n"),
        ],
        [
          "a conditionally rebound alias-assigned method-factory-returned function mutation",
          [
            `const factory = {};`,
            `let alias = factory;`,
            `if (globalThis.useOtherFactory) alias = {};`,
            `alias.make = () => function (intrinsic) {`,
            `  intrinsic.defineProperty = recordAndReturn;`,
            `};`,
            `factory.make()(Object);`,
          ].join("\n"),
        ],
        [
          "an intrinsic mutation invoked through call",
          `Object.defineProperty.call(null, Object, "defineProperty", { value: recordAndReturn });`,
        ],
        [
          "an intrinsic mutation invoked through apply",
          `Object.defineProperty.apply(null, [Object, "defineProperty", { value: recordAndReturn }]);`,
        ],
        [
          "a global merge invoked through call",
          [
            `const patch = { Object: { defineProperty: recordAndReturn } };`,
            `Object.assign.call(null, globalThis, patch);`,
          ].join("\n"),
        ],
        [
          "a global merge invoked through apply",
          [
            `const patch = { Object: { defineProperty: recordAndReturn } };`,
            `Object.assign.apply(null, [globalThis, patch]);`,
          ].join("\n"),
        ],
        [
          "an intrinsic alias produced by a value expression",
          [
            `const intrinsic = (0, Object);`,
            `intrinsic.defineProperty = recordAndReturn;`,
          ].join("\n"),
        ],
      ]
    ) {
      it(`does not treat ${label} as compiler metadata`, async () => {
        const code = [
          `function recordAndReturn(target) {`,
          `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
          `  return target;`,
          `}`,
          mutation,
          `var setName = (target, value) => Object.defineProperty(`,
          `  target, "name", { value, configurable: true },`,
          `);`,
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SECRET_KEY");`,
          `function loadSecret() { return KEY; }`,
          `setName(loadSecret, "loadSecret");`,
          `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code);

        assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
        assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      });
    }

    it("still strips metadata through the effective last object method", async () => {
      const code = [
        `const factory = {`,
        `  make() {`,
        `    return function (intrinsic) {`,
        `      intrinsic.defineProperty = (target) => target;`,
        `    };`,
        `  },`,
        `  make() { return function (_intrinsic) {}; },`,
        `};`,
        `factory.make()(Object);`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertEquals(occurrences(result, "KEY"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    it("still strips metadata after an owner alias is rebound", async () => {
      const code = [
        `const factory = { make() { return function (_intrinsic) {}; } };`,
        `let alias = factory;`,
        `alias = {};`,
        `alias.make = () => function (intrinsic) {`,
        `  intrinsic.defineProperty = (target) => target;`,
        `};`,
        `factory.make()(Object);`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertEquals(occurrences(result, "KEY"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    it("keeps metadata after a write to a hoisted function owner", async () => {
      const code = [
        `owner.make = () => function (intrinsic) {`,
        `  intrinsic.defineProperty = (target) => target;`,
        `};`,
        `function owner() {}`,
        `owner.make()(Object);`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("still strips metadata after a hoisted function owner is rebound", async () => {
      const code = [
        `owner.make = () => function (intrinsic) {`,
        `  intrinsic.defineProperty = (target) => target;`,
        `};`,
        `owner = { make: () => function (_intrinsic) {} };`,
        `function owner() {}`,
        `owner.make()(Object);`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertEquals(occurrences(result, "KEY"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    it("still strips metadata after an invoked function rebinds its hoisted owner", async () => {
      const code = [
        `const mutatingFactory = () => function (intrinsic) {`,
        `  intrinsic.defineProperty = (target) => target;`,
        `};`,
        `const safeFactory = () => function (_intrinsic) {};`,
        `function configure() {`,
        `  owner.make = mutatingFactory;`,
        `  owner = { make: safeFactory };`,
        `  function owner() {}`,
        `  owner.make()(Object);`,
        `}`,
        `configure();`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertEquals(occurrences(result, "KEY"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    it("uses the effective final duplicate function declaration", async () => {
      const code = [
        `function configure() {`,
        `  function factory() {`,
        `    return function (intrinsic) {`,
        `      intrinsic.defineProperty = (target) => target;`,
        `    };`,
        `  }`,
        `  function factory() { return function (_intrinsic) {}; }`,
        `  factory()(Object);`,
        `}`,
        `configure();`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertEquals(occurrences(result, "KEY"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    it("keeps metadata when a deferred function may rebind an owner", async () => {
      const code = [
        `const mutatingFactory = () => function (intrinsic) {`,
        `  intrinsic.defineProperty = (target) => target;`,
        `};`,
        `const safeFactory = () => function (_intrinsic) {};`,
        `let owner = { make: mutatingFactory };`,
        `function rebindLater() { owner = { make: safeFactory }; }`,
        `owner.make()(Object);`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("keeps metadata when a conditional rebind may leave a mutating owner", async () => {
      const code = [
        `const mutatingFactory = () => function (intrinsic) {`,
        `  intrinsic.defineProperty = (target) => target;`,
        `};`,
        `const safeFactory = () => function (_intrinsic) {};`,
        `function configure(useSafeFactory) {`,
        `  let owner = { make: mutatingFactory };`,
        `  if (useSafeFactory) owner = { make: safeFactory };`,
        `  owner.make()(Object);`,
        `}`,
        `configure(globalThis.useSafeFactory);`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    for (
      const [label, invocation] of [
        [
          "a short-circuiting owner assignment",
          [
            `owner ||= { make: safeFactory };`,
            `owner.make()(Object);`,
          ].join("\n"),
        ],
        [
          "a short-circuiting owner assignment expression",
          `(owner ||= { make: safeFactory }).make()(Object);`,
        ],
      ] as const
    ) {
      it(`keeps metadata after ${label}`, async () => {
        const code = [
          `const mutatingFactory = () => function (intrinsic) {`,
          `  intrinsic.defineProperty = (target) => target;`,
          `};`,
          `const safeFactory = () => function (_intrinsic) {};`,
          `let owner = { make: mutatingFactory };`,
          invocation,
          `var setName = (target, value) => Object.defineProperty(`,
          `  target, "name", { value, configurable: true },`,
          `);`,
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SECRET_KEY");`,
          `function loadSecret() { return KEY; }`,
          `setName(loadSecret, "loadSecret");`,
          `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code);

        assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
        assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      });
    }

    it("still strips metadata after a direct owner rebind", async () => {
      const code = [
        `const mutatingFactory = () => function (intrinsic) {`,
        `  intrinsic.defineProperty = (target) => target;`,
        `};`,
        `const safeFactory = () => function (_intrinsic) {};`,
        `let owner = { make: mutatingFactory };`,
        `owner = { make: safeFactory };`,
        `owner.make()(Object);`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertEquals(occurrences(result, "KEY"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    it("still strips metadata after a direct member overwrite", async () => {
      const code = [
        `const mutatingFactory = () => function (intrinsic) {`,
        `  intrinsic.defineProperty = (target) => target;`,
        `};`,
        `const safeFactory = () => function (_intrinsic) {};`,
        `const owner = {};`,
        `owner.make = mutatingFactory;`,
        `owner.make = safeFactory;`,
        `owner.make()(Object);`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertEquals(occurrences(result, "KEY"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    for (
      const [label, ownerFlow] of [
        [
          "a conditional member overwrite",
          [
            `const owner = { make: mutatingFactory };`,
            `if (globalThis.useSafeFactory) owner.make = safeFactory;`,
          ].join("\n"),
        ],
        [
          "a deferred member overwrite",
          [
            `const owner = { make: mutatingFactory };`,
            `function rebindLater() { owner.make = safeFactory; }`,
          ].join("\n"),
        ],
        [
          "a member overwrite through an ambiguous alias",
          [
            `const owner = { make: mutatingFactory };`,
            `const other = {};`,
            `const alias = globalThis.useSafeFactory ? owner : other;`,
            `alias.make = safeFactory;`,
          ].join("\n"),
        ],
        [
          "a short-circuiting member assignment",
          [
            `const owner = { make: mutatingFactory };`,
            `owner.make ||= safeFactory;`,
          ].join("\n"),
        ],
      ] as const
    ) {
      it(`keeps metadata after ${label}`, async () => {
        const code = [
          `const mutatingFactory = () => function (intrinsic) {`,
          `  intrinsic.defineProperty = (target) => target;`,
          `};`,
          `const safeFactory = () => function (_intrinsic) {};`,
          ownerFlow,
          `owner.make()(Object);`,
          `var setName = (target, value) => Object.defineProperty(`,
          `  target, "name", { value, configurable: true },`,
          `);`,
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SECRET_KEY");`,
          `function loadSecret() { return KEY; }`,
          `setName(loadSecret, "loadSecret");`,
          `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code);

        assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
        assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      });
    }

    for (
      const [label, ownerFlow] of [
        [
          "a nested object member factory",
          `const namespace = { factory: { make: mutatingFactory } };`,
        ],
        [
          "a write to a nested object member factory",
          [
            `const namespace = { factory: { make: safeFactory } };`,
            `namespace.factory.make = mutatingFactory;`,
          ].join("\n"),
        ],
      ] as const
    ) {
      it(`keeps metadata through ${label}`, async () => {
        const code = [
          `const mutatingFactory = () => function (intrinsic) {`,
          `  intrinsic.defineProperty = (target) => target;`,
          `};`,
          `const safeFactory = () => function (_intrinsic) {};`,
          ownerFlow,
          `namespace.factory.make()(Object);`,
          `var setName = (target, value) => Object.defineProperty(`,
          `  target, "name", { value, configurable: true },`,
          `);`,
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SECRET_KEY");`,
          `function loadSecret() { return KEY; }`,
          `setName(loadSecret, "loadSecret");`,
          `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code);

        assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
        assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      });
    }

    it("still strips metadata after a nested member overwrite", async () => {
      const code = [
        `const mutatingFactory = () => function (intrinsic) {`,
        `  intrinsic.defineProperty = (target) => target;`,
        `};`,
        `const safeFactory = () => function (_intrinsic) {};`,
        `const namespace = { factory: { make: mutatingFactory } };`,
        `namespace.factory.make = safeFactory;`,
        `namespace.factory.make()(Object);`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertEquals(occurrences(result, "KEY"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    it("keeps metadata after a write through an object-destructured owner", async () => {
      const code = [
        `const mutatingFactory = () => function (intrinsic) {`,
        `  intrinsic.defineProperty = (target) => target;`,
        `};`,
        `const safeFactory = () => function (_intrinsic) {};`,
        `const namespace = { factory: { make: safeFactory } };`,
        `const { factory: alias } = namespace;`,
        `alias.make = mutatingFactory;`,
        `namespace.factory.make()(Object);`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    for (
      const [label, ownerFlow] of [
        [
          "an object-destructured factory",
          [
            `const owner = { make: mutatingFactory };`,
            `const { make } = owner;`,
          ].join("\n"),
        ],
        [
          "an array-destructured factory",
          `const [make] = [mutatingFactory];`,
        ],
      ] as const
    ) {
      it(`keeps metadata through ${label}`, async () => {
        const code = [
          `const mutatingFactory = () => function (intrinsic) {`,
          `  intrinsic.defineProperty = (target) => target;`,
          `};`,
          ownerFlow,
          `make()(Object);`,
          `var setName = (target, value) => Object.defineProperty(`,
          `  target, "name", { value, configurable: true },`,
          `);`,
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SECRET_KEY");`,
          `function loadSecret() { return KEY; }`,
          `setName(loadSecret, "loadSecret");`,
          `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code);

        assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
        assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      });
    }

    it("keeps metadata through a statically resolved computed factory call", async () => {
      const code = [
        `const mutatingFactory = () => function (intrinsic) {`,
        `  intrinsic.defineProperty = (target) => target;`,
        `};`,
        `const owner = { make: mutatingFactory };`,
        `const key = "make";`,
        `owner[key]()(Object);`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("keeps metadata through a runtime-selected local factory call", async () => {
      const code = [
        `const mutatingFactory = () => function (intrinsic) {`,
        `  intrinsic.defineProperty = (target) => target;`,
        `};`,
        `const owner = { make: mutatingFactory };`,
        `owner[globalThis.factoryKey]()(Object);`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("keeps metadata when a computed key has known and runtime-selected flows", async () => {
      const code = [
        `const mutatingFactory = () => function (intrinsic) {`,
        `  intrinsic.defineProperty = (target) => target;`,
        `};`,
        `const safeFactory = () => function (_intrinsic) {};`,
        `const owner = { safe: safeFactory, make: mutatingFactory };`,
        `const key = globalThis.useSafe ? "safe" : globalThis.factoryKey;`,
        `owner[key]()(Object);`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("keeps metadata when a computed-key factory has an unresolved return flow", async () => {
      const code = [
        `const mutatingFactory = () => function (intrinsic) {`,
        `  intrinsic.defineProperty = (target) => target;`,
        `};`,
        `const safeFactory = () => function (_intrinsic) {};`,
        `const owner = { safe: safeFactory, make: mutatingFactory };`,
        `const key = (() => globalThis.useSafe ? "safe" : globalThis.factoryKey)();`,
        `owner[key]()(Object);`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("keeps metadata through an unresolved computed object member", async () => {
      const code = [
        `const mutatingFactory = () => function (intrinsic) {`,
        `  intrinsic.defineProperty = (target) => target;`,
        `};`,
        `const key = globalThis.factoryKey;`,
        `const owner = { [key]: mutatingFactory };`,
        `owner[key]()(Object);`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("keeps metadata when a member value flow refers to itself", async () => {
      const code = [
        `const mutatingFactory = () => function (intrinsic) {`,
        `  intrinsic.defineProperty = (target) => target;`,
        `};`,
        `const owner = { make: mutatingFactory };`,
        `owner.make = owner.make;`,
        `owner.make()(Object);`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("keeps metadata after a write through a computed object-destructured owner", async () => {
      const code = [
        `const mutatingFactory = () => function (intrinsic) {`,
        `  intrinsic.defineProperty = (target) => target;`,
        `};`,
        `const safeFactory = () => function (_intrinsic) {};`,
        `const namespace = { factory: { make: safeFactory } };`,
        `const key = "factory";`,
        `const { [key]: alias } = namespace;`,
        `alias.make = mutatingFactory;`,
        `namespace.factory.make()(Object);`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("keeps metadata after a write through a runtime-selected destructured owner", async () => {
      const code = [
        `const mutatingFactory = () => function (intrinsic) {`,
        `  intrinsic.defineProperty = (target) => target;`,
        `};`,
        `const safeFactory = () => function (_intrinsic) {};`,
        `const namespace = { factory: { make: safeFactory } };`,
        `const { [globalThis.factoryKey]: alias } = namespace;`,
        `alias.make = mutatingFactory;`,
        `namespace.factory.make()(Object);`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("keeps metadata after a nested write through an object-rest owner", async () => {
      const code = [
        `const mutatingFactory = () => function (intrinsic) {`,
        `  intrinsic.defineProperty = (target) => target;`,
        `};`,
        `const safeFactory = () => function (_intrinsic) {};`,
        `const namespace = { factory: { make: safeFactory } };`,
        `const { ...copy } = namespace;`,
        `copy.factory.make = mutatingFactory;`,
        `namespace.factory.make()(Object);`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("still strips metadata after a safe write through an object-destructured owner", async () => {
      const code = [
        `const mutatingFactory = () => function (intrinsic) {`,
        `  intrinsic.defineProperty = (target) => target;`,
        `};`,
        `const safeFactory = () => function (_intrinsic) {};`,
        `const namespace = { factory: { make: mutatingFactory } };`,
        `const { factory: alias } = namespace;`,
        `alias.make = safeFactory;`,
        `namespace.factory.make()(Object);`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertEquals(occurrences(result, "KEY"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    it("still strips metadata after a dominating overwrite before a conditional read", async () => {
      const code = [
        `const mutatingFactory = () => function (intrinsic) {`,
        `  intrinsic.defineProperty = (target) => target;`,
        `};`,
        `const safeFactory = () => function (_intrinsic) {};`,
        `const owner = {};`,
        `owner.make = mutatingFactory;`,
        `owner.make = safeFactory;`,
        `if (globalThis.runFactory) owner.make()(Object);`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertEquals(occurrences(result, "KEY"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    it("keeps metadata when a later loop write can reach the next iteration", async () => {
      const code = [
        `const mutatingFactory = () => function (intrinsic) {`,
        `  intrinsic.defineProperty = (target) => target;`,
        `};`,
        `const safeFactory = () => function (_intrinsic) {};`,
        `const owner = { make: safeFactory };`,
        `for (let index = 0; index < 2; index++) {`,
        `  owner.make()(Object);`,
        `  owner.make = mutatingFactory;`,
        `}`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("still strips metadata past a write through a shadowing alias parameter", async () => {
      const code = [
        `const intrinsic = Object;`,
        `const alias = intrinsic;`,
        `function configure(alias) { alias.other = 1; }`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertEquals(occurrences(result, "KEY"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    for (const invocation of ["call(null, Object)", "apply(null, [Object])"]) {
      it(`keeps a generator ${invocation} body deferred during mutation analysis`, async () => {
        const code = [
          `function recordAndReturn(target) { return target; }`,
          `(function* (intrinsic) { intrinsic.defineProperty = recordAndReturn; }).${invocation};`,
          `var setName = (target, value) => Object.defineProperty(`,
          `  target, "name", { value, configurable: true },`,
          `);`,
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SECRET_KEY");`,
          `function loadSecret() { return KEY; }`,
          `setName(loadSecret, "loadSecret");`,
          `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code);

        assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
        assertEquals(occurrences(result, "KEY"), 0);
        assertEquals(occurrences(result, "getEnv"), 0);
      });
    }

    for (
      const globalObject of [
        "window.Object",
        "self.Object",
        "frames.Object",
        'window["Object"]',
        "(window as any).Object",
      ]
    ) {
      it(`does not treat an aliased ${globalObject} intrinsic as compiler metadata`, async () => {
        const code = [
          `function recordAndReturn(target) {`,
          `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
          `  return target;`,
          `}`,
          `const intrinsic = ${globalObject};`,
          `intrinsic.defineProperty = recordAndReturn;`,
          `var setName = (target, value) => Object.defineProperty(`,
          `  target, "name", { value, configurable: true },`,
          `);`,
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SECRET_KEY");`,
          `function loadSecret() { return KEY; }`,
          `setName(loadSecret, "loadSecret");`,
          `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code);

        assertStringIncludes(result, `const intrinsic = ${globalObject}`);
        assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
        assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      });
    }

    for (
      const globalObject of [
        "window.window.Object",
        "window.self.Object",
        "window.frames.Object",
      ]
    ) {
      it(`does not treat nested alias ${globalObject} as compiler metadata`, async () => {
        const code = [
          `function recordAndReturn(target) {`,
          `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
          `  return target;`,
          `}`,
          `const intrinsic = ${globalObject};`,
          `intrinsic.defineProperty = recordAndReturn;`,
          `var setName = (target, value) => Object.defineProperty(`,
          `  target, "name", { value, configurable: true },`,
          `);`,
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SECRET_KEY");`,
          `function loadSecret() { return KEY; }`,
          `setName(loadSecret, "loadSecret");`,
          `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code);

        assertStringIncludes(result, `const intrinsic = ${globalObject}`);
        assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
        assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      });
    }

    it("does not treat an aliased browser global as compiler metadata", async () => {
      const code = [
        `function recordAndReturn(target) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `const scope = window;`,
        `scope.Object = { defineProperty: recordAndReturn };`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "const scope = window");
      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    // `typeof window` yields a string, never a reference the module can use to
    // reach the intrinsic, so the ubiquitous SSR guard must not stop compiler
    // metadata from being pruned.
    it("still strips compiler metadata after a typeof window guard", async () => {
      const code = [
        `const isBrowser = typeof window !== "undefined" && typeof self !== "undefined";`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return isBrowser ? null : null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertEquals(occurrences(result, "KEY"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
      assertStringIncludes(result, "typeof window");
    });

    it("still strips compiler metadata after TypeScript-wrapped typeof guards", async () => {
      const code = [
        `const isBrowser = typeof (window as unknown) !== "undefined" && typeof self! !== "undefined";`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return isBrowser ? null : null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertEquals(occurrences(result, "KEY"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
      assertStringIncludes(result, "typeof (window as unknown)");
      assertStringIncludes(result, "typeof self!");
    });

    it("preserves member-base context through TypeScript wrappers", async () => {
      const code = [
        `const hasDocument = (window as unknown as { document?: unknown }).document !== undefined;`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return hasDocument ? null : null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, ").document");
      assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertEquals(occurrences(result, "KEY"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    for (const globalObject of ["globalThis.Object", 'globalThis["Object"]']) {
      it(`does not treat an aliased ${globalObject} intrinsic as compiler metadata`, async () => {
        const code = [
          `function recordAndReturn(target) {`,
          `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
          `  return target;`,
          `}`,
          `const intrinsic = ${globalObject};`,
          `intrinsic.defineProperty = recordAndReturn;`,
          `var setName = (target, value) => Object.defineProperty(`,
          `  target, "name", { value, configurable: true },`,
          `);`,
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SECRET_KEY");`,
          `function loadSecret() { return KEY; }`,
          `setName(loadSecret, "loadSecret");`,
          `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code);

        assertStringIncludes(result, `const intrinsic = ${globalObject}`);
        assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
        assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      });
    }

    it("does not treat a hoisted name helper redeclaration as compiler metadata", async () => {
      const code = [
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `function recordAndReturn(target) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `if (globalThis.patchNames) { var setName = recordAndReturn; }`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "setName = recordAndReturn");
      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("does not treat a Reflect-replaced intrinsic as compiler metadata", async () => {
      const code = [
        `function recordAndReturn(target) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `Reflect.defineProperty(Object, "defineProperty", { value: recordAndReturn });`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `Reflect.defineProperty(Object, "defineProperty"`);
      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("does not treat a globalThis-rooted intrinsic write as compiler metadata", async () => {
      const code = [
        `function recordAndReturn(target) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `globalThis.Object.defineProperty = recordAndReturn;`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "globalThis.Object.defineProperty = recordAndReturn");
      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("does not treat a replaced globalThis.Object as compiler metadata", async () => {
      const code = [
        `function recordAndReturn(target) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `globalThis.Object = { defineProperty: recordAndReturn };`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "globalThis.Object = {");
      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("does not treat a defineProperty replacement of globalThis.Object as compiler metadata", async () => {
      const code = [
        `function recordAndReturn(target) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `Object.defineProperty(globalThis, "Object", {`,
        `  value: { defineProperty: recordAndReturn },`,
        `  configurable: true,`,
        `});`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `Object.defineProperty(globalThis, "Object"`);
      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("does not treat a Reflect replacement of globalThis.Object as compiler metadata", async () => {
      const code = [
        `function recordAndReturn(target) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `Reflect.defineProperty(globalThis, "Object", {`,
        `  value: { defineProperty: recordAndReturn },`,
        `  configurable: true,`,
        `});`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `Reflect.defineProperty(globalThis, "Object"`);
      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("does not treat an aliased global object as compiler metadata", async () => {
      const code = [
        `function recordAndReturn(target) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `const scope = globalThis;`,
        `scope.Object = { defineProperty: recordAndReturn };`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "scope.Object = ");
      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("does not treat a computed intrinsic write as compiler metadata", async () => {
      const code = [
        `function recordAndReturn(target) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `Object[globalThis.patchedName] = recordAndReturn;`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "Object[globalThis.patchedName] = recordAndReturn");
      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("still strips compiler metadata after an unrelated defineProperty write", async () => {
      const code = [
        `const registry = {};`,
        `registry.defineProperty = (target) => target;`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "registry.defineProperty");
      assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertEquals(occurrences(result, "KEY"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    it("still strips compiler metadata after a shadowed globalThis write", async () => {
      const code = [
        `function configure(globalThis) {`,
        `  globalThis.Object = { defineProperty: (target) => target };`,
        `}`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "globalThis.Object = {");
      assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertEquals(occurrences(result, "KEY"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    it("still strips compiler metadata after a shadowed Object write", async () => {
      const code = [
        `function configure(Object) {`,
        `  Object.defineProperty = (target) => target;`,
        `}`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "Object.defineProperty =");
      assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertEquals(occurrences(result, "KEY"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    it("still strips compiler metadata after a shadowed Object assignment", async () => {
      const code = [
        `function configure(Object) {`,
        `  Object = { defineProperty: (target) => target };`,
        `}`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "Object = {");
      assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertEquals(occurrences(result, "KEY"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    // A TypeScript type wrapper around the operand of `typeof` still yields a
    // string, so the guard must read the same as the untyped form.
    for (const guard of ["(window as unknown)", "window!", "(<unknown> window)"]) {
      it(`still strips compiler metadata after a typeof ${guard} guard`, async () => {
        const code = [
          `const isBrowser = typeof ${guard} !== "undefined";`,
          `var setName = (target, value) => Object.defineProperty(`,
          `  target, "name", { value, configurable: true },`,
          `);`,
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SECRET_KEY");`,
          `function loadSecret() { return KEY; }`,
          `setName(loadSecret, "loadSecret");`,
          `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
          `export default function Page() { return isBrowser ? null : null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code, "pages/guard.ts");

        assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
        assertEquals(occurrences(result, "KEY"), 0);
        assertEquals(occurrences(result, "getEnv"), 0);
        assertStringIncludes(result, "typeof");
      });
    }

    // `frames`, `parent`, `top`, and `document.defaultView` reach the same
    // window as `window` does in a main browsing context.
    for (
      const globalObject of [
        "frames.Object",
        "parent.Object",
        "top.Object",
        "document.defaultView.Object",
      ]
    ) {
      it(`does not treat an aliased ${globalObject} intrinsic as compiler metadata`, async () => {
        const code = [
          `function recordAndReturn(target) {`,
          `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
          `  return target;`,
          `}`,
          `const intrinsic = ${globalObject};`,
          `intrinsic.defineProperty = recordAndReturn;`,
          `var setName = (target, value) => Object.defineProperty(`,
          `  target, "name", { value, configurable: true },`,
          `);`,
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SECRET_KEY");`,
          `function loadSecret() { return KEY; }`,
          `setName(loadSecret, "loadSecret");`,
          `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code);

        assertStringIncludes(result, `const intrinsic = ${globalObject}`);
        assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
        assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      });
    }

    // A TypeScript namespace emits runtime code, so its body can hold the
    // intrinsic in a slot the module writes through later.
    for (const keyword of ["namespace", "module"]) {
      it(`does not treat a ${keyword} that holds the intrinsic as compiler metadata`, async () => {
        const code = [
          `function recordAndReturn(target) {`,
          `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
          `  return target;`,
          `}`,
          `${keyword} Patch { export const intrinsic = globalThis.Object; }`,
          `Patch.intrinsic.defineProperty = recordAndReturn;`,
          `var setName = (target, value) => Object.defineProperty(`,
          `  target, "name", { value, configurable: true },`,
          `);`,
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SECRET_KEY");`,
          `function loadSecret() { return KEY; }`,
          `setName(loadSecret, "loadSecret");`,
          `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code, "pages/ns.ts");

        assertStringIncludes(result, "Patch.intrinsic.defineProperty = recordAndReturn");
        assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
        assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      });
    }

    it("does not treat a namespace-held intrinsic alias as compiler metadata", async () => {
      const code = [
        `function recordAndReturn(target) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `namespace Patch { export const intrinsic = Object; }`,
        `Patch.intrinsic.defineProperty = recordAndReturn;`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/ns.ts");

      assertStringIncludes(result, "Patch.intrinsic.defineProperty = recordAndReturn");
      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    // A read that only hands the intrinsic to a callee, spreads it, or binds a
    // name nothing writes through cannot replace `Object.defineProperty`, and
    // these shapes are everywhere in ordinary client code. Treating them as
    // escapes retained the helper, its hook-only initialiser, and the server
    // import that fed it.
    for (
      const [label, read] of [
        ["a plain global alias", `const scope = window;`],
        [
          "a global alias inside a client callback",
          `function useBrowser() { useEffect(() => { const scope = window; return scope.name; }); }`,
        ],
        ["an Object.assign onto the global", `Object.assign(globalThis, {});`],
        ["a spread of the global", `const snapshot = { ...window };`],
        ["the global passed to a callee", `report(globalThis);`],
        ["the intrinsic passed as a callback", `const kinds = [].map(Object);`],
        ["an ordinary constructor comparison", `const plain = value?.constructor === Object;`],
        ["constructor-name logging", `const errorName = error.constructor.name;`],
        ["an ordinary __proto__ read", `const prototype = value.__proto__;`],
        ["an instanceof Function check", `const callable = value instanceof Function;`],
        ["a typeof eval check", `const evalType = typeof eval;`],
      ]
    ) {
      it(`still strips compiler metadata past ${label}`, async () => {
        const code = [
          `import { useEffect } from "react";`,
          `import { report } from "./report.ts";`,
          read,
          `var setName = (target, value) => Object.defineProperty(`,
          `  target, "name", { value, configurable: true },`,
          `);`,
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SECRET_KEY");`,
          `function loadSecret() { return KEY; }`,
          `setName(loadSecret, "loadSecret");`,
          `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code);

        assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
        assertEquals(occurrences(result, "KEY"), 0);
        assertEquals(occurrences(result, "getEnv"), 0);
        assertNotIncludes(result, "SECRET_KEY");
      });
    }

    // The prototype chain and the `Function` constructor reach the intrinsic
    // without ever naming `Object` as a value. The recognised set does not
    // admit a module that carries either route.
    for (
      const [label, route] of [
        [
          "an object literal's constructor",
          `({}).constructor.defineProperty = recordAndReturn;`,
        ],
        [
          "a prototype's constructor",
          `Object.getPrototypeOf({}).constructor.defineProperty = recordAndReturn;`,
        ],
        [
          "the Function constructor",
          `"".constructor.constructor(` +
          `"globalThis.Object.defineProperty = arguments[0]"` +
          `)(recordAndReturn);`,
        ],
        [
          "an aliased Function constructor",
          [
            `const compile = Function;`,
            `compile("globalThis.Object.defineProperty = arguments[0]")(`,
            `  recordAndReturn,`,
            `);`,
          ].join("\n"),
        ],
        [
          "aliased eval",
          [
            `const run = eval;`,
            `run("globalThis.Object.defineProperty = (target) => target");`,
          ].join("\n"),
        ],
        [
          "global-object eval",
          `globalThis.eval("Object.defineProperty = (target) => target");`,
        ],
        [
          "global-object Function constructor",
          `window.Function("Object.defineProperty = (target) => target")();`,
        ],
        [
          "destructured global-object eval",
          [
            `const { eval: run } = globalThis;`,
            `run("Object.defineProperty = (target) => target");`,
          ].join("\n"),
        ],
        [
          "array-destructured global-object eval",
          [
            `const [run] = [globalThis.eval];`,
            `run("Object.defineProperty = (target) => target");`,
          ].join("\n"),
        ],
        [
          "defaulted array-destructured global-object eval",
          [
            `const [run = globalThis.eval] = [];`,
            `run("Object.defineProperty = (target) => target");`,
          ].join("\n"),
        ],
        [
          "defaulted array destructuring from an initially undefined binding",
          [
            `let value;`,
            `const [run = globalThis.eval] = [value];`,
            `value = () => {};`,
            `run("Object.defineProperty = (target) => target");`,
          ].join("\n"),
        ],
      ]
    ) {
      it(`does not treat a module reaching the intrinsic through ${label} as compiler metadata`, async () => {
        const code = [
          `function recordAndReturn(target) {`,
          `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
          `  return target;`,
          `}`,
          route,
          `var setName = (target, value) => Object.defineProperty(`,
          `  target, "name", { value, configurable: true },`,
          `);`,
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SECRET_KEY");`,
          `function loadSecret() { return KEY; }`,
          `setName(loadSecret, "loadSecret");`,
          `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code);

        assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
        assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      });
    }

    // The recognised set has to admit what real compiled modules contain. A
    // CommonJS interop prologue calls the intrinsic on its own exports object,
    // and ordinary code writes computed keys on locals all the time; neither
    // can reach `Object.defineProperty`, so neither may cost the module its
    // compiler metadata.
    for (
      const [label, line] of [
        [
          "a CommonJS interop marker",
          `Object.defineProperty(exports, "__esModule", { value: true });`,
        ],
        ["a computed write on a local", `const bag = {};\nfor (const k of ["a"]) { bag[k] = 1; }`],
        ["an index write on a local array", `const arr = [];\narr[0] = 1;`],
        ["a member write on an instance", `class Box { fill() { this.items = []; } }`],
        [
          "an intrinsic held only by a shadowed nested binding",
          [
            `var intrinsic = {};`,
            `function getIntrinsic() { const intrinsic = Object; return intrinsic; }`,
            `intrinsic.defineProperty = () => {};`,
          ].join("\n"),
        ],
      ]
    ) {
      it(`still strips compiler metadata past ${label}`, async () => {
        const code = [
          line,
          `var setName = (target, value) => Object.defineProperty(`,
          `  target, "name", { value, configurable: true },`,
          `);`,
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SECRET_KEY");`,
          `function loadSecret() { return KEY; }`,
          `setName(loadSecret, "loadSecret");`,
          `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code);

        assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
        assertEquals(occurrences(result, "KEY"), 0);
        assertEquals(occurrences(result, "getEnv"), 0);
      });
    }

    for (
      const [label, mutation] of [
        [
          "a dynamic intrinsic property name",
          [
            `const propertyName = "defineProperty";`,
            `Object.defineProperty(`,
            `  Object, propertyName, { value: recordAndReturn },`,
            `);`,
          ].join("\n"),
        ],
        [
          "a Reflect.apply intrinsic mutation",
          `Reflect.apply(` +
          `Object.defineProperty, null, ` +
          `[Object, "defineProperty", { value: recordAndReturn }])`,
        ],
        [
          "a Reflect.apply function-literal mutation",
          [
            `Reflect.apply(function (intrinsic) {`,
            `  intrinsic.defineProperty = recordAndReturn;`,
            `}, null, [Object]);`,
          ].join("\n"),
        ],
        [
          "a Reflect.apply sequence-wrapped function-literal mutation",
          [
            `Reflect.apply((0, function (intrinsic) {`,
            `  intrinsic.defineProperty = recordAndReturn;`,
            `}), null, [Object]);`,
          ].join("\n"),
        ],
        [
          "an immediately advanced generator mutation",
          [
            `(function* (intrinsic) {`,
            `  intrinsic.defineProperty = recordAndReturn;`,
            `})(Object).next();`,
          ].join("\n"),
        ],
        [
          "a stored and advanced generator mutation",
          [
            `const iterator = (function* (intrinsic) {`,
            `  intrinsic.defineProperty = recordAndReturn;`,
            `})(Object);`,
            `iterator.next();`,
          ].join("\n"),
        ],
        [
          "a call-wrapped stored generator advancement",
          [
            `const iterator = (function* (intrinsic) {`,
            `  intrinsic.defineProperty = recordAndReturn;`,
            `})(Object);`,
            `iterator.next.call(iterator);`,
          ].join("\n"),
        ],
        [
          "a Reflect.apply-wrapped stored generator advancement",
          [
            `const iterator = (function* (intrinsic) {`,
            `  intrinsic.defineProperty = recordAndReturn;`,
            `})(Object);`,
            `Reflect.apply(iterator.next, iterator, []);`,
          ].join("\n"),
        ],
        [
          "a transitively stored and advanced generator mutation",
          [
            `const iterator = (function* (intrinsic) {`,
            `  intrinsic.defineProperty = recordAndReturn;`,
            `})(Object);`,
            `const iteratorAlias = iterator;`,
            `iteratorAlias.next();`,
          ].join("\n"),
        ],
        [
          "an assigned and advanced generator mutation",
          [
            `let iterator;`,
            `iterator = (function* (intrinsic) {`,
            `  intrinsic.defineProperty = recordAndReturn;`,
            `})(Object);`,
            `iterator.next();`,
          ].join("\n"),
        ],
        [
          "a named and advanced generator mutation",
          [
            `function* mutateIntrinsic(intrinsic) {`,
            `  intrinsic.defineProperty = recordAndReturn;`,
            `}`,
            `const iterator = mutateIntrinsic(Object);`,
            `iterator.next();`,
          ].join("\n"),
        ],
        [
          "a delegated generator mutation",
          [
            `(function* (outer) {`,
            `  yield* (function* (intrinsic) {`,
            `    intrinsic.defineProperty = recordAndReturn;`,
            `  })(outer);`,
            `})(Object).next();`,
          ].join("\n"),
        ],
        [
          "a direct class-constructor mutation",
          [
            `new (class {`,
            `  constructor(intrinsic) {`,
            `    intrinsic.defineProperty = recordAndReturn;`,
            `  }`,
            `})(Object);`,
          ].join("\n"),
        ],
        [
          "an aliased class-constructor mutation",
          [
            `const Mutator = class {`,
            `  constructor(intrinsic) {`,
            `    intrinsic.defineProperty = recordAndReturn;`,
            `  }`,
            `};`,
            `new Mutator(Object);`,
          ].join("\n"),
        ],
        [
          "a named class-declaration constructor mutation",
          [
            `class Mutator {`,
            `  constructor(intrinsic) {`,
            `    intrinsic.defineProperty = recordAndReturn;`,
            `  }`,
            `}`,
            `new Mutator(Object);`,
          ].join("\n"),
        ],
        [
          "an inherited implicit-constructor mutation",
          [
            `class Base {`,
            `  constructor(intrinsic) {`,
            `    intrinsic.defineProperty = recordAndReturn;`,
            `  }`,
            `}`,
            `class Mutator extends Base {}`,
            `new Mutator(Object);`,
          ].join("\n"),
        ],
        [
          "a spread-consumed generator mutation",
          [
            `[...(function* (intrinsic) {`,
            `  intrinsic.defineProperty = recordAndReturn;`,
            `})(Object)];`,
          ].join("\n"),
        ],
        [
          "a for-of-consumed generator mutation",
          [
            `for (const unused of (function* (intrinsic) {`,
            `  intrinsic.defineProperty = recordAndReturn;`,
            `})(Object)) { void unused; }`,
          ].join("\n"),
        ],
        [
          "a destructuring-consumed generator mutation",
          [
            `const [unused] = (function* (intrinsic) {`,
            `  intrinsic.defineProperty = recordAndReturn;`,
            `  yield 1;`,
            `})(Object);`,
            `void unused;`,
          ].join("\n"),
        ],
        [
          "an Array.from-consumed generator mutation",
          [
            `Array.from((function* (intrinsic) {`,
            `  intrinsic.defineProperty = recordAndReturn;`,
            `})(Object));`,
          ].join("\n"),
        ],
        [
          "a Set-consumed generator mutation",
          [
            `new Set((function* (intrinsic) {`,
            `  intrinsic.defineProperty = recordAndReturn;`,
            `})(Object));`,
          ].join("\n"),
        ],
        [
          "an assignment-destructuring-consumed generator mutation",
          [
            `let unused;`,
            `[unused] = (function* (intrinsic) {`,
            `  intrinsic.defineProperty = recordAndReturn;`,
            `  yield 1;`,
            `})(Object);`,
            `void unused;`,
          ].join("\n"),
        ],
        [
          "an aliased intrinsic mutator",
          [
            `const mutate = Object.defineProperty;`,
            `mutate(Object, "defineProperty", { value: recordAndReturn });`,
          ].join("\n"),
        ],
        [
          "a transitive intrinsic mutator alias",
          [
            `const mutate = Object.defineProperty;`,
            `const transitiveMutate = mutate;`,
            `transitiveMutate(Object, "defineProperty", { value: recordAndReturn });`,
          ].join("\n"),
        ],
        [
          "a bound intrinsic mutator alias",
          [
            `const mutate = Object.defineProperty.bind(Object);`,
            `mutate(Object, "defineProperty", { value: recordAndReturn });`,
          ].join("\n"),
        ],
        [
          "a destructured intrinsic mutator alias",
          [
            `const { defineProperty: mutate } = Object;`,
            `mutate(Object, "defineProperty", { value: recordAndReturn });`,
          ].join("\n"),
        ],
        [
          "a Reflect-destructured intrinsic mutator alias",
          [
            `const { defineProperty: mutate } = Reflect;`,
            `mutate(Object, "defineProperty", { value: recordAndReturn });`,
          ].join("\n"),
        ],
        [
          "an Object-alias-destructured intrinsic mutator",
          [
            `const intrinsic = Object;`,
            `const { defineProperty: mutate } = intrinsic;`,
            `mutate(Object, "defineProperty", { value: recordAndReturn });`,
          ].join("\n"),
        ],
        [
          "an awaited Object-alias-destructured intrinsic mutator",
          [
            `const intrinsic = await Object;`,
            `const { defineProperty: mutate } = intrinsic;`,
            `mutate(Object, "defineProperty", { value: recordAndReturn });`,
          ].join("\n"),
        ],
        [
          "a global-destructured intrinsic container mutator",
          [
            `const { Object: intrinsic } = globalThis;`,
            `const { defineProperty: mutate } = intrinsic;`,
            `mutate(Object, "defineProperty", { value: recordAndReturn });`,
          ].join("\n"),
        ],
        [
          "a reflected constructor alias written through",
          [
            `const intrinsic = ({}).constructor;`,
            `intrinsic.defineProperty = recordAndReturn;`,
          ].join("\n"),
        ],
      ]
    ) {
      it(`does not treat ${label} as compiler metadata`, async () => {
        const code = [
          `function recordAndReturn(target) {`,
          `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
          `  return target;`,
          `}`,
          mutation,
          `var setName = (target, value) => Object.defineProperty(`,
          `  target, "name", { value, configurable: true },`,
          `);`,
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SECRET_KEY");`,
          `function loadSecret() { return KEY; }`,
          `setName(loadSecret, "loadSecret");`,
          `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code);

        assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
        assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      });
    }

    it("still strips compiler metadata when one next call stops before a delegated mutation", async () => {
      const code = [
        `function recordAndReturn(target) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `const iterator = (function* (outer) {`,
        `  yield 1;`,
        `  yield* (function* (intrinsic) {`,
        `    intrinsic.defineProperty = recordAndReturn;`,
        `  })(outer);`,
        `})(Object);`,
        `iterator.next();`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertEquals(occurrences(result, "KEY"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
      assertNotIncludes(result, "SECRET_KEY");
    });

    it("still strips compiler metadata when one next call stops at a nested yield", async () => {
      const code = [
        `function recordAndReturn(target) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `const iterator = (function* (outer) {`,
        `  if (true) yield 1;`,
        `  yield* (function* (intrinsic) {`,
        `    intrinsic.defineProperty = recordAndReturn;`,
        `  })(outer);`,
        `})(Object);`,
        `iterator.next();`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertEquals(occurrences(result, "KEY"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
      assertNotIncludes(result, "SECRET_KEY");
    });

    // `defineProperties` installs a descriptor map's keys on its target just as
    // `assign` copies a source's own keys, so a map this stage cannot read key
    // by key leaves the replacement invisible.
    // A module-scope `var` is bound where the enclosing body prebinds its
    // direct declarations and again in the var scope, so a write through it
    // used to resolve to a different binding than its own declaration.
    for (
      const [label, lines] of [
        [
          "a var intrinsic alias",
          [`var intrinsic = Object;`, `intrinsic.defineProperty = recordAndReturn;`],
        ],
        [
          "a var alias declared inside a block",
          [
            `if (globalThis.patch) { var hoistedAlias = Object; }`,
            `hoistedAlias.defineProperty = recordAndReturn;`,
          ],
        ],
        [
          "a var alias written through from a function",
          [
            `var deferredAlias = Object;`,
            `function applyPatch() { deferredAlias.defineProperty = recordAndReturn; }`,
            `applyPatch();`,
          ],
        ],
      ] as const
    ) {
      it(`does not treat ${label} as compiler metadata`, async () => {
        const code = [
          `function recordAndReturn(target) {`,
          `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
          `  return target;`,
          `}`,
          ...lines,
          `var setName = (target, value) => Object.defineProperty(`,
          `  target, "name", { value, configurable: true },`,
          `);`,
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SECRET_KEY");`,
          `function loadSecret() { return KEY; }`,
          `setName(loadSecret, "loadSecret");`,
          `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code);

        assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
        assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      });
    }

    // `f.call.call(f, …)` invokes `f` with one more receiver peeled off, so
    // unwrapping a single wrapper leaves `f.call` as the apparent callee.
    for (
      const [label, invocation] of [
        [
          "a nested call wrapper",
          `Object.defineProperty.call.call(` +
          `Object.defineProperty, null, Object, "defineProperty", { value: recordAndReturn })`,
        ],
        [
          "a nested apply wrapper",
          `Object.defineProperty.call.apply(` +
          `Object.defineProperty, [null, Object, "defineProperty", { value: recordAndReturn }])`,
        ],
      ]
    ) {
      it(`does not treat ${label} on the intrinsic as compiler metadata`, async () => {
        const code = [
          `function recordAndReturn(target) {`,
          `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
          `  return target;`,
          `}`,
          `${invocation};`,
          `var setName = (target, value) => Object.defineProperty(`,
          `  target, "name", { value, configurable: true },`,
          `);`,
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SECRET_KEY");`,
          `function loadSecret() { return KEY; }`,
          `setName(loadSecret, "loadSecret");`,
          `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code);

        assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
        assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
      });
    }

    // A spread hides how many sources a merge takes, not what its target is.
    // A merge onto a fresh local cannot reach the intrinsic however many
    // unreadable sources follow, so it must not cost the module its metadata.
    it("still strips compiler metadata past a spread merge onto a fresh target", async () => {
      const code = [
        `Object.assign.call(null, {}, ...[]);`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertEquals(occurrences(result, "KEY"), 0);
      assertEquals(occurrences(result, "getEnv"), 0);
    });

    it("does not treat a spread merge onto the global object as compiler metadata", async () => {
      const code = [
        `function recordAndReturn(target) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `Object.assign(globalThis, ...[{ Object: recordAndReturn }]);`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("does not treat named descriptors installed on the intrinsic as compiler metadata", async () => {
      const code = [
        `function recordAndReturn(target) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `const descriptors = { defineProperty: { value: recordAndReturn } };`,
        `Object.defineProperties(Object, descriptors);`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "Object.defineProperties(Object, descriptors)");
      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("does not treat an eval of a replacement as compiler metadata", async () => {
      const code = [
        `eval("globalThis.Object.defineProperty = (target) => target");`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    // A `function` declaration and a `var` cannot share a name in a module:
    // the redeclaration is a SyntaxError, so a hoisted user function can never
    // be the live binding when a later `var` initialiser classifies it. The
    // build stops on the parse failure rather than analysing the module.
    it("fails the build when a name helper redeclares a function declaration", async () => {
      const code = [
        `function setName(target, value) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() => stripServerOnlyExports(code, "pages/x.tsx"));

      assertStringIncludes((error as Error).message, "setName");
    });

    it("keeps a helper call made before an exported var redeclaration", async () => {
      const code = [
        `function recordAndReturn(target) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `export var setName = recordAndReturn;`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `var setName = (target, value) => Object.defineProperty(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "export var setName = recordAndReturn");
      assertStringIncludes(result, `setName(loadSecret, "loadSecret")`);
      assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
    });

    it("fails the build when an intrinsic alias redeclares a function declaration", async () => {
      const code = [
        `function defineName(target, key, descriptor) {`,
        `  globalThis.nameRegistrations = (globalThis.nameRegistrations ?? 0) + 1;`,
        `  return target;`,
        `}`,
        `var setName = (target, value) => defineName(`,
        `  target, "name", { value, configurable: true },`,
        `);`,
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `function loadSecret() { return KEY; }`,
        `setName(loadSecret, "loadSecret");`,
        `var defineName = Object.defineProperty;`,
        `export async function getServerData() { return { props: { k: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() => stripServerOnlyExports(code, "pages/x.tsx"));

      assertStringIncludes((error as Error).message, "defineName");
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
    // esbuild's tree-shaker can never close: a destructuring of a call (even a
    // `@__PURE__`-annotated one) is kept in both transform and bundle mode
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
    // reads one of its bindings, the whole declarator (and its import) stay.
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
    // binding of the same pattern used to keep the declarator alive forever:
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
    // a time ("is this name mentioned anywhere else?"), so two hook-only
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

    it("keeps a nested var destructuring that reads a block-local shadow", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SECRET_KEY");`,
        `{`,
        `  const KEY = {`,
        `    get value() { globalThis.reads = (globalThis.reads ?? 0) + 1; return "client"; },`,
        `  };`,
        `  var { value } = KEY;`,
        `}`,
        `export async function getServerData() { return { props: { k: KEY } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "globalThis.reads");
      assertStringIncludes(result, "var {");
      assertStringIncludes(result, "} = KEY;");
      assertNotIncludes(result, "SECRET_KEY");
      assertNotIncludes(result, `from "veryfront"`);
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
    // reads the secret if something calls it, and nothing reaches `handler`.
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
      const [label, invocation] of [
        [
          "satisfies expression",
          `(function () { globalThis.registered = KEY; return true; } satisfies () => boolean)()`,
        ],
        [
          "type assertion",
          `(<() => boolean> function () { globalThis.registered = KEY; return true; })()`,
        ],
      ] as const
    ) {
      it(`keeps a module-evaluation read from an IIFE wrapped in a ${label}`, async () => {
        const code = [
          `import { getEnv } from "veryfront";`,
          `const KEY = getEnv("SECRET_KEY");`,
          `const ran = ${invocation};`,
          `export async function getServerData() { return { props: { k: KEY } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n");

        const result = await stripServerOnlyExports(code, "pages/iife.ts");

        assertStringIncludes(result, `const KEY = getEnv("SECRET_KEY")`);
        assertStringIncludes(result, "globalThis.registered = KEY");
      });
    }

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
    // module's own side effect. When the binding it calls survives (because
    // browser code calls it too) removing the statement would silently delete
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
  // and the declarations are left bare. That difference is not cosmetic; it is
  // the only form in which the export contract reaches this stage, and a rule
  // keyed on `export`-wrapped declarations silently does nothing here. These
  // cases compile first, so a regression that only shows up after esbuild
  // cannot pass unnoticed.
  describe("compiled input", () => {
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

      // Nothing in the module calls `InputBox`; its only consumer is the export
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
});
