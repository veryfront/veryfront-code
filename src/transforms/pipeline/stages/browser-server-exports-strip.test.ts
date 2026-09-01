import "#veryfront/schemas/_test-setup.ts";
import "../../plugins/__tests__/code-parser-setup.ts";
import "../../mdx/compiler/__tests__/content-processor-setup.ts";
import { stop as stopEsbuild } from "#veryfront/platform/compat/esbuild.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import type { CodeParser } from "#veryfront/extensions/parser/index.ts";
import {
  getErrorCollector,
  resetErrorCollector,
} from "#veryfront/observability/error-collector.ts";
import {
  browserServerExportsStripInternals,
  browserServerExportsStripPlugin,
  moduleReferenceWalkers,
  stripServerOnlyExports,
} from "./browser-server-exports-strip.ts";
import { runPipeline } from "../index.ts";
import { type TransformContext, TransformStage } from "../types.ts";
import { VeryfrontError } from "#veryfront/errors";

function assertNotIncludes(haystack: string, needle: string): void {
  assertEquals(haystack.includes(needle), false, `expected not to find ${needle} in:\n${haystack}`);
}

/** Identifier occurrences, so "kept the import" and "kept the binding" differ. */
function occurrences(haystack: string, name: string): number {
  return haystack.match(new RegExp(`\\b${name}\\b`, "g"))?.length ?? 0;
}

async function assertUnsafeServerDestructuring(code: string): Promise<VeryfrontError> {
  const error = await assertRejects(
    () => stripServerOnlyExports(code, "pages/unsafe-destructuring.tsx"),
    VeryfrontError,
  );
  assertInstanceOf(error, VeryfrontError);
  assertEquals(error.slug, "server-only-in-client");
  assertStringIncludes(error.message, "Move the destructuring into getServerData");
  assertStringIncludes(error.message, "Declare client initialization separately");
  assertStringIncludes(error.message, 'import { getEnv } from "veryfront"');
  assertStringIncludes(error.message, "export default function Page()");
  return error;
}

async function bindingPatternAnalysis(source: string) {
  const parser = tryResolve<CodeParser>("CodeParser");
  if (!parser) throw new Error("CodeParser extension is not registered");
  const ast = await parser.parse({ code: source, filePath: "pattern.ts" });
  const statement = (ast as unknown as { program: { body: Array<Record<string, unknown>> } })
    .program.body[0];
  if (!statement) throw new Error(`No statement parsed from: ${source}`);
  const declarator = (statement.declarations as Array<Record<string, unknown>> | undefined)?.[0];
  if (!declarator) throw new Error(`No declarator parsed from: ${source}`);
  return browserServerExportsStripInternals.analyzeBindingPattern(declarator.id);
}

describe("browser-server-exports-strip", () => {
  afterAll(async () => {
    await stopEsbuild();
  });

  describe("binding-pattern classification", () => {
    it("collects nested object, array, hole, rest, and renamed binding positions", async () => {
      const analysis = await bindingPatternAnalysis(
        "const { plain, renamed: alias, nested: { value }, list: [first, , ...tail], ...rest } = source;",
      );

      assertEquals(analysis.bindingNames, ["plain", "alias", "value", "first", "tail", "rest"]);
      assertEquals(analysis.hazards, []);
    });

    it("separates a default expression from its binding position", async () => {
      const analysis = await bindingPatternAnalysis("const { source: value = fallback } = input;");

      assertEquals(analysis.bindingNames, ["value"]);
      assertEquals(analysis.possibleNames, ["value"]);
      assertEquals(analysis.hazards, ["default-value"]);
    });

    it("separates a computed key from its binding position", async () => {
      const analysis = await bindingPatternAnalysis("const { [keyName]: value } = input;");

      assertEquals(analysis.bindingNames, ["value"]);
      assertEquals(analysis.possibleNames, ["value"]);
      assertEquals(analysis.hazards, ["computed-key"]);
    });

    it("classifies unknown pattern syntax without trusting possible bindings", () => {
      const analysis = browserServerExportsStripInternals.analyzeBindingPattern({
        type: "FutureBindingPattern",
        child: { type: "Identifier", name: "possibleBinding" },
      });

      assertEquals(analysis.bindingNames, []);
      assertEquals(analysis.possibleNames, ["possibleBinding"]);
      assertEquals(analysis.hazards, ["unknown-syntax"]);
    });
  });

  describe("emptying server-only hooks", () => {
    it("runs before custom pre-compile browser plugins see server-only code", async () => {
      const source = [
        `const SERVER_SECRET = "secret-from-server-hook";`,
        `export async function getServerData() {`,
        `  return { props: { secret: SERVER_SECRET } };`,
        `}`,
        `export default function Page() { return null; }`,
      ].join("\n");

      let customPluginSawSecret = false;
      const result = await runPipeline(
        source,
        "/project/pages/test.tsx",
        "/project",
        { projectId: "strip-before-custom-plugin", dev: false, ssr: false },
        {
          plugins: [{
            name: "pre-compile-observer",
            stage: TransformStage.PARSE + 0.75,
            transform: (ctx) => {
              customPluginSawSecret = ctx.code.includes("SERVER_SECRET");
              return ctx.code;
            },
          }],
        },
      );

      assertEquals(customPluginSawSecret, false);
      assertNotIncludes(result.code, "SERVER_SECRET");
      assertNotIncludes(result.code, "secret-from-server-hook");
    });

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

    it("parses embedded TSX framework source before deciding it has no server hooks", async () => {
      const code = [
        `export function TooltipProvider({ children }: { children: React.ReactNode }) {`,
        `  return <TooltipContext.Provider value={{}}>{children}</TooltipContext.Provider>;`,
        `}`,
      ].join("\n");

      assertEquals(
        await stripServerOnlyExports(code, "react/components/ui/tooltip.tsx.src"),
        code,
      );
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

    it("does not keep a hook-only import because its name matches an intrinsic JSX tag", async () => {
      const code = [
        `import { table } from "../server/table.ts";`,
        `export async function getServerData() {`,
        `  return { props: { table: table() } };`,
        `}`,
        `export default function Page() {`,
        `  return <table><tbody /></table>;`,
        `}`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "page.tsx");

      assertNotIncludes(result, "../server/table.ts");
      assertEquals(occurrences(result, "table"), 2);
      assertStringIncludes(result, "<table>");
    });

    it("keeps a JSX member object that browser code still reads", async () => {
      const code = [
        `import { motion } from "../client/motion.ts";`,
        `const helper = motion;`,
        `export async function getServerData() {`,
        `  return { props: { helper } };`,
        `}`,
        `export default function Page() {`,
        `  return <motion.div />;`,
        `}`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "page.tsx");

      assertStringIncludes(result, "../client/motion.ts");
      assertStringIncludes(result, "motion.div");
    });

    it("keeps leading JSX import-source comments when the first statement is removed", async () => {
      const code = [
        `/** @jsxImportSource preact */`,
        `import { loadSecret } from "../server/load-secret.ts";`,
        `export async function getServerData() {`,
        `  return { props: { secret: loadSecret() } };`,
        `}`,
        `export default function Page() { return <main />; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "page.tsx");

      assertStringIncludes(result, "@jsxImportSource preact");
      assertNotIncludes(result, "../server/load-secret.ts");
    });

    it("does not delete an unrelated top-level binding named like a class expression", async () => {
      const code = [
        `import { initClient } from "../client/init.ts";`,
        `const Inner = initClient();`,
        `const Factory = class Inner {`,
        `  static make() { return Inner; }`,
        `};`,
        `export async function getServerData() {`,
        `  return { props: { Factory } };`,
        `}`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "page.tsx");

      assertStringIncludes(result, "../client/init.ts");
      assertStringIncludes(result, "const Inner = initClient()");
      assertNotIncludes(result, "class Inner");
    });

    it("matches escaped server-only export names before deciding to skip parsing", async () => {
      const escapedHookName = "get\\u0053erverData";
      const code = [
        `import { getEnv } from "veryfront";`,
        `const SECRET = getEnv("ORDERS_SECRET");`,
        `function loadIt() { return { props: { SECRET } }; }`,
        `export { loadIt as ${escapedHookName} };`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "page.tsx");

      assertNotIncludes(result, "ORDERS_SECRET");
      assertNotIncludes(result, "getEnv");
      assertStringIncludes(result, "getServerData");
    });

    it("fails closed when a server hook is an import-equals alias", async () => {
      const code = [
        `import Loader = require("../server/loader.ts");`,
        `export { Loader as getServerData };`,
        `export default function Page() { return null; }`,
      ].join("\n");

      await assertRejects(
        () => stripServerOnlyExports(code, "page.ts"),
        Error,
        "import Loader = require",
      );
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

      // The barrel is gone completely. Not even a side-effect import survives.
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

    // Secret-leak fix: a module-scope value computed for a server-only hook,
    // `const API_KEY = getEnv("SECRET_KEY")` read only inside getServerData,
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
    // it. Pruning is scoped to declarations nothing else references.
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
    // hook must survive. Only the hook's own closure is removed.
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

    // The hook can be an arrow assigned to `const`. Its closure must be
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

    it("drops a destructured module-scope server value", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const { a } = getEnv("X");`,
        `export async function getServerData() { return { props: { a } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "getEnv");
      assertEquals(occurrences(result, "a"), 0);
    });

    it("drops nested, array, and rest bindings used only by the hook", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const { nested: { value }, list: [first, , ...rest] } = getEnv("SERVER_ONLY");`,
        `export async function getServerData() { return { props: { value, first, rest } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "SERVER_ONLY");
      assertNotIncludes(result, "getEnv");
      assertEquals(occurrences(result, "value"), 0);
      assertEquals(occurrences(result, "first"), 0);
      assertEquals(occurrences(result, "rest"), 0);
    });

    it("drops a known-framework rest pattern when an unused sibling is outside the hook closure", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const { unusedByEveryone, ...rest } = getEnv("SERVER_ONLY");`,
        `export async function getServerData() { return { props: { rest } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "SERVER_ONLY");
      assertNotIncludes(result, "getEnv");
      assertEquals(occurrences(result, "unusedByEveryone"), 0);
      assertEquals(occurrences(result, "rest"), 0);
    });

    it("recognizes aliased and namespace framework imports as known server initializers", async () => {
      const variants = [
        [
          `import { getEnv as readEnv } from "veryfront";`,
          `const { unused, ...rest } = readEnv("SERVER_ONLY");`,
        ],
        [
          `import * as vf from "veryfront";`,
          `const { unused, ...rest } = vf.getEnv("SERVER_ONLY");`,
        ],
      ];

      for (const [importLine, declaration] of variants) {
        const result = await stripServerOnlyExports([
          importLine,
          declaration,
          `export async function getServerData() { return { props: { rest } }; }`,
          `export default function Page() { return null; }`,
        ].join("\n"));

        assertNotIncludes(result, "SERVER_ONLY");
        assertNotIncludes(result, "veryfront");
      }
    });

    it("rejects a server-hook destructuring default instead of shipping it", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const DEFAULT = getEnv("CLIENT_FALLBACK");`,
        `const { a = DEFAULT } = getEnv("SERVER_ONLY");`,
        `export async function getServerData() { return { props: { a } }; }`,
        `export default function Page() { return DEFAULT; }`,
      ].join("\n");

      const error = await assertUnsafeServerDestructuring(code);
      assertStringIncludes(error.message, "Module: pages/unsafe-destructuring.tsx");
      assertStringIncludes(error.message, "Bindings: a");
    });

    it("rejects a computed server-hook pattern instead of shipping it", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("CLIENT_KEY");`,
        `const { [KEY]: value } = getEnv("SERVER_ONLY");`,
        `export async function getServerData() { return { props: { value } }; }`,
        `export default function Page() { return KEY; }`,
      ].join("\n");

      await assertUnsafeServerDestructuring(code);
    });

    it("removes one destructuring declarator without dropping its client sibling", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const { a } = getEnv("SERVER_ONLY"), client = bootClient();`,
        `export async function getServerData() { return { props: { a } }; }`,
        `export default function Page() { return client; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "SERVER_ONLY");
      assertNotIncludes(result, "getEnv");
      assertStringIncludes(result, "client = bootClient()");
      assertStringIncludes(result, "return client");
    });

    it("does not let a hazardous co-declarator pin a known server rest pattern", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const { unused, ...rest } = getEnv("SERVER_REST"), { client = startClient() } = loadClient();`,
        `export async function getServerData() { return { props: { rest } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "SERVER_REST");
      assertNotIncludes(result, "getEnv");
      assertStringIncludes(result, "client = startClient()");
      assertStringIncludes(result, "loadClient()");
    });

    it("does not let a hazardous co-declarator pin a simple server value", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const token = getEnv("SERVER_SIMPLE"), { client = startClient() } = loadClient();`,
        `export async function getServerData() { return { props: { token } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "SERVER_SIMPLE");
      assertNotIncludes(result, "getEnv");
      assertStringIncludes(result, "client = startClient()");
      assertStringIncludes(result, "loadClient()");
    });

    it("keeps a server declarator a hazardous client co-declarator still reads", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const token = getEnv("CLIENT_FALLBACK"), { client = token } = loadClient();`,
        `export async function getServerData() { return { props: { token } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "CLIENT_FALLBACK");
      assertStringIncludes(result, "getEnv");
      assertStringIncludes(result, "client = token");
      assertStringIncludes(result, "loadClient()");
    });

    it("rejects a destructuring default with an unrelated client effect", async () => {
      const code = [
        `const { token, client = startClient() } = loadSecret();`,
        `export async function getServerData() { return { props: { token } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      await assertUnsafeServerDestructuring(code);
    });

    it("rejects a computed pattern key with an unrelated client effect", async () => {
      const code = [
        `const { [startClient()]: token } = loadSecret();`,
        `export async function getServerData() { return { props: { token } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      await assertUnsafeServerDestructuring(code);
    });

    it("rejects an unknown side-effecting initializer with a sibling outside the hook closure", async () => {
      const code = [
        `const { token, client } = loadSecret();`,
        `export async function getServerData() { return { props: { token } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      await assertUnsafeServerDestructuring(code);
    });

    it("rejects a project-local initializer with a sibling outside the hook closure", async () => {
      const code = [
        `import { loadSecret } from "./server.ts";`,
        `const { token, client } = loadSecret();`,
        `export async function getServerData() { return { props: { token } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      await assertUnsafeServerDestructuring(code);
    });

    it("rejects an effectful argument to a known-framework initializer", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `const { token, client } = getEnv(startClient());`,
        `export async function getServerData() { return { props: { token } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      await assertUnsafeServerDestructuring(code);
    });

    it("keeps a destructuring initializer when the browser reads a sibling binding", async () => {
      const code = [
        `const { token, client } = loadSecret();`,
        `export async function getServerData() { return { props: { token } }; }`,
        `export default function Page() { return client; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "loadSecret()");
      assertStringIncludes(result, "return client");
    });

    it("keeps an evaluated pattern when the browser reads a sibling binding", async () => {
      const code = [
        `const { token, client = startClient() } = loadSecret();`,
        `export async function getServerData() { return { props: { token } }; }`,
        `export default function Page() { return client; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "loadSecret()");
      assertStringIncludes(result, "client = startClient()");
      assertStringIncludes(result, "return client");
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

    it("deletes a mixed import whose surviving specifier nothing reads", async () => {
      const code = [
        `import { initClient, loadSecret } from "./client-setup.ts";`,
        `export async function getServerData() { return { props: { token: loadSecret() } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "./client-setup.ts");
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
      return { code, target, filePath: "pages/test.tsx", metadata: new Map() } as TransformContext;
    }

    function pageWithUnownedUnusedImport(): string {
      return [
        `import { initClientMetrics } from "./client-metrics.ts";`,
        `export async function getServerData() { return { props: {} }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");
    }

    function assertNoClientMetricsImport(code: string): void {
      assertNotIncludes(code, "client-metrics.ts");
      assertEquals(occurrences(code, "initClientMetrics"), 0);
    }

    function assertBareClientMetricsImport(code: string): void {
      assertEquals(/import\s*["'][^"']*client-metrics[^"']*["'];/.test(code), true);
      assertNotIncludes(code, "import { initClientMetrics }");
      assertEquals(occurrences(code, "initClientMetrics"), 0);
    }

    function assertOneBareProjectImport(code: string): void {
      const sideEffectImports = code.match(/import\s*["'][^"']+["'];/g) ?? [];
      assertEquals(sideEffectImports.length, 1, code);
      assertStringIncludes(sideEffectImports[0] ?? "", "/_veryfront/fs/");
      assertEquals(occurrences(code, "initClientMetrics"), 0);
    }

    it("removes a known server destructuring dependency from the browser pipeline", async () => {
      const source = [
        `import { getEnv } from "veryfront";`,
        `const { unused, ...rest } = getEnv("SERVER_ONLY_PIPELINE_VALUE");`,
        `export async function getServerData() { return { props: { rest } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await runPipeline(
        source,
        "/project/pages/destructuring.tsx",
        "/project",
        { projectId: "server-destructuring-strip", dev: false, ssr: false },
      );

      assertNotIncludes(result.code, "SERVER_ONLY_PIPELINE_VALUE");
      assertNotIncludes(result.code, "getEnv");
    });

    it("returns a stable boundary error for ambiguous browser destructuring", async () => {
      const source = [
        `const { token, unused } = loadSecret();`,
        `export async function getServerData() { return { props: { token } }; }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(
        () =>
          runPipeline(
            source,
            "/project/pages/ambiguous.tsx",
            "/project",
            { projectId: "ambiguous-server-destructuring", dev: false, ssr: false },
          ),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "server-only-in-client");
    });

    it("accepts decorators after export before compiling browser modules", async () => {
      const source = [
        `function logged(value: unknown) { return value; }`,
        `const SECRET = "SERVER_ONLY_DECORATOR_SECRET";`,
        `export async function getServerData() { return { props: { secret: SECRET } }; }`,
        `export @logged class PageModel {}`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await runPipeline(
        source,
        "/project/pages/decorated.tsx",
        "/project",
        { projectId: "decorator-after-export-strip", dev: false, ssr: false },
      );

      assertNotIncludes(result.code, "SERVER_ONLY_DECORATOR_SECRET");
      assertStringIncludes(result.code, "PageModel");
    });

    it("classifies authored browser parse errors as tenant compilation failures", async () => {
      resetErrorCollector();
      const source = [
        `export async function getServerData() { return { props: {} }; }`,
        `export default function Page( { return null; }`,
      ].join("\n");

      try {
        const error = await assertRejects(
          () =>
            runPipeline(
              source,
              "/project/pages/broken.tsx",
              "/project",
              { projectId: "authored-strip-parse-error", dev: false, ssr: false },
            ),
          VeryfrontError,
        );

        assertInstanceOf(error, VeryfrontError);
        assertEquals(error.slug, "compilation-error");
        assertEquals(
          (error.context as { tenantBuildFailure?: unknown } | undefined)?.tenantBuildFailure,
          true,
        );

        const compileErrors = getErrorCollector().getAll({ type: "compile" });
        assertEquals(compileErrors.length, 1);
        assertEquals(compileErrors[0]?.file, "/project/pages/broken.tsx");
        assertStringIncludes(compileErrors[0]?.message ?? "", "Unexpected keyword");
      } finally {
        resetErrorCollector();
      }
    });

    it("strips modules with legacy parameter decorators before compiling browser modules", async () => {
      const source = [
        `function inject(_target: unknown, _key: string, _index: number) {}`,
        `const SECRET = "SERVER_ONLY_PARAMETER_DECORATOR_SECRET";`,
        `export async function getServerData() { return { props: { secret: SECRET } }; }`,
        `class PageModel { load(@inject dep: unknown) { return dep; } }`,
        `export default function Page() { return PageModel; }`,
      ].join("\n");

      const result = await browserServerExportsStripPlugin.transform({
        ...ctx(source, "browser"),
        filePath: "/project/pages/parameter-decorator.tsx",
      } as TransformContext);

      assertNotIncludes(result, "SERVER_ONLY_PARAMETER_DECORATOR_SECRET");
      assertStringIncludes(result, "PageModel");
    });

    it("strips modules with legacy decorator type arguments before compiling browser modules", async () => {
      const source = [
        `function logged<T>(value: T) { return value; }`,
        `const SECRET = "SERVER_ONLY_GENERIC_DECORATOR_SECRET";`,
        `export async function getServerData() { return { props: { secret: SECRET } }; }`,
        `@logged<string> export class PageModel {}`,
        `export default function Page() { return PageModel; }`,
      ].join("\n");

      const result = await runPipeline(
        source,
        "/project/pages/generic-decorator.tsx",
        "/project",
        { projectId: "generic-decorator-strip", dev: false, ssr: false },
      );

      assertNotIncludes(result.code, "SERVER_ONLY_GENERIC_DECORATOR_SECRET");
      assertStringIncludes(result.code, "PageModel");
    });

    it("does not claim tenant ownership of generated Markdown or MDX parse diagnostics", async () => {
      const source = [
        `export async function getServerData() { return { props: {} }; }`,
        `export default function Page( { return null; }`,
      ].join("\n");

      for (const extension of ["md", "mdx"]) {
        const error = await assertRejects(
          async () =>
            await browserServerExportsStripPlugin.transform({
              ...ctx(source, "browser"),
              filePath: `/project/pages/generated.${extension}`,
            } as TransformContext),
          VeryfrontError,
        );

        assertInstanceOf(error, VeryfrontError);
        assertEquals(error.slug, "compilation-error");
        assertEquals(
          (error.context as { tenantBuildFailure?: unknown } | undefined)?.tenantBuildFailure,
          false,
        );
      }
    });

    it("keeps missing parser failures framework owned", async () => {
      const previous = tryResolve<CodeParser>("CodeParser");
      unregister("CodeParser");

      try {
        const error = await assertRejects(
          async () =>
            await browserServerExportsStripPlugin.transform(
              ctx(`export async function getServerData() { return { props: {} }; }`, "browser"),
            ),
          Error,
        );

        assertEquals(error instanceof VeryfrontError, false);
        assertStringIncludes((error as Error).message, "no CodeParser extension is registered");
      } finally {
        if (previous !== undefined) register("CodeParser", previous);
      }
    });

    it("keeps parser-internal failures framework owned", async () => {
      const parser = tryResolve<CodeParser>("CodeParser");
      if (!parser) throw new Error("no CodeParser extension is registered");

      const failingParser: CodeParser = {
        parse: (options) => {
          if (options.code.includes("__vfStub")) return parser.parse(options);
          return Promise.reject(new Error("parser exploded internally"));
        },
        traverse: (ast, visitor) => parser.traverse(ast, visitor),
        generate: (ast, options) => parser.generate(ast, options),
        injectJsxNodePositions: (source, options) => parser.injectJsxNodePositions(source, options),
        hasFunctionDirective: parser.hasFunctionDirective?.bind(parser),
        findStaticCommonJsImports: parser.findStaticCommonJsImports?.bind(parser),
      };
      register("CodeParser", failingParser);

      try {
        const error = await assertRejects(
          async () =>
            await browserServerExportsStripPlugin.transform(
              ctx(`export async function getServerData() { return { props: {} }; }`, "browser"),
            ),
          Error,
        );

        assertEquals(error instanceof VeryfrontError, false);
        assertStringIncludes((error as Error).message, "parser exploded internally");
      } finally {
        register("CodeParser", parser);
      }
    });

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

    it("lets compile erase unrelated unused TS and TSX named imports", async () => {
      for (const extension of ["ts", "tsx"]) {
        const result = await runPipeline(
          pageWithUnownedUnusedImport(),
          `/project/pages/test.${extension}`,
          "/project",
          { projectId: `unused-import-${extension}`, dev: false, ssr: false },
        );

        assertNoClientMetricsImport(result.code);
      }
    });

    it("retains only a side-effect import for unrelated unused JS and JSX imports", async () => {
      for (const extension of ["js", "jsx"]) {
        const result = await runPipeline(
          pageWithUnownedUnusedImport(),
          `/project/pages/test.${extension}`,
          "/project",
          { projectId: `unused-import-${extension}`, dev: false, ssr: false },
        );

        assertBareClientMetricsImport(result.code);
      }
    });

    it("retains only a side-effect import for unrelated unused generated MDX imports", async () => {
      const source = [
        `import { initClientMetrics } from "./client-metrics.ts";`,
        ``,
        `export async function getServerData() { return { props: {} }; }`,
        ``,
        `# Dashboard`,
      ].join("\n");

      const result = await runPipeline(
        source,
        "/project/pages/test.mdx",
        "/project",
        { projectId: "unused-import-mdx", dev: false, ssr: false },
      );

      assertOneBareProjectImport(result.code);
    });

    it("builds the dev compile map from stripped browser input", async () => {
      const source = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SERVER_VALUE");`,
        `const CLIENT_MARKER = "//# sourceMappingURL=data:text/plain;base64,AAAA";`,
        `export async function getServerData() { return { props: { key: KEY } }; }`,
        `export default function Page() { return CLIENT_MARKER; }`,
      ].join("\n");

      const result = await runPipeline(
        source,
        "/project/pages/test.tsx",
        "/project",
        { projectId: "source-map-after-strip", dev: true, ssr: false },
      );

      assertNotIncludes(result.code, "SERVER_VALUE");
      assertStringIncludes(result.code, "sourceMappingURL=data:application/json;base64,");
      assertStringIncludes(result.code, "sourceMappingURL=data:text/plain;base64,AAAA");
      const match = result.code.match(
        /\/\/[#@]\s*sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/]+={0,2})/,
      );
      assertEquals(match === null, false);
      const sourceMap = JSON.parse(atob(match?.[1] ?? "")) as {
        sourcesContent?: string[];
      };
      assertEquals(
        sourceMap.sourcesContent?.some((content) => content.includes("SERVER_VALUE")),
        false,
      );
    });

    it("removes a pre-existing source map directive after stripping", async () => {
      const source = [
        `import { getEnv } from "veryfront";`,
        `const KEY = getEnv("SERVER_VALUE");`,
        `const CLIENT_MARKER = "//# sourceMappingURL=data:text/plain;base64,AAAA";`,
        `export async function getServerData() { return { props: { key: KEY } }; }`,
        `export default function Page() { return CLIENT_MARKER; }`,
        `//# sourceMappingURL=data:application/json;base64,AAAA`,
      ].join("\n");

      const result = await browserServerExportsStripPlugin.transform(ctx(source, "browser"));

      assertNotIncludes(result, "SERVER_VALUE");
      assertNotIncludes(result, "sourceMappingURL=data:application/json;base64,");
      assertStringIncludes(result, "sourceMappingURL=data:text/plain;base64,AAAA");
    });

    it("keeps the stripped compile map after an intermediate plugin appends code", async () => {
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
      assertStringIncludes(result.code, "sourceMappingURL=data:application/json;base64,");
      assertStringIncludes(result.code, "export const APPENDED = true;");
      const match = result.code.match(
        /\/\/[#@]\s*sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/]+={0,2})/,
      );
      assertEquals(match === null, false);
      const sourceMap = JSON.parse(atob(match?.[1] ?? "")) as {
        sourcesContent?: string[];
      };
      assertEquals(
        sourceMap.sourcesContent?.some((content) => content.includes("SERVER_ONLY_HOOK_SOURCE")),
        false,
      );
    });

    it("allows a later plugin to copy the stripped compile map string", async () => {
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
      assertStringIncludes(result.code, "sourceMappingURL=data:application/json;base64,");
      assertStringIncludes(result.code, "COPIED_COMPILE_MAP");
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
        // import by dropUnusedImportBindings, which is pre-existing behavior
        // and not what this case is about.
        assertNotIncludes(result, "{ audit }");
        assertStringIncludes(result, `import "./audit.ts"`);
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
        assertNotIncludes(result, "../lib/server-only.ts");
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
        assertNotIncludes(result, "../lib/server-only.ts");
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
        assertNotIncludes(result, "../lib/server-only.ts");
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
