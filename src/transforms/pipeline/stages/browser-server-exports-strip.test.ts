import "#veryfront/schemas/_test-setup.ts";
import "../../plugins/__tests__/code-parser-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
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

    it("leaves a local declaration that is only aliased to a hook name alone", async () => {
      // `other` is the local declaration; `getServerData` is only its public
      // name, so the client-side body of `other` must survive.
      const code = [
        `function other() { return computeOnClient(); }`,
        `export { other as getServerData };`,
      ].join("\n");

      assertEquals(await stripServerOnlyExports(code), code);
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

    it("leaves a module that does not parse unchanged", async () => {
      const code = `export function getServerData( { this is not javascript`;
      assertEquals(await stripServerOnlyExports(code), code);
    });
  });

  describe("import bindings", () => {
    // Regression: deleting the statement dropped the module's top-level side
    // effects with it.
    it("reduces an unreferenced project import to a side-effect import", async () => {
      const code = [
        `import { loadOnStart } from "./client-init-and-data.ts";`,
        `export async function getServerData() { return loadOnStart(); }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      // The module still evaluates, so its side effects survive.
      assertStringIncludes(result, "./client-init-and-data.ts");
      // The binding that caused the link-time failure is gone.
      assertEquals(occurrences(result, "loadOnStart"), 0);
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

    it("reduces a namespace import the client no longer uses", async () => {
      const code = [
        `import * as helpers from "../lib/util-bag.js";`,
        `export async function getServerData() { return helpers.load(); }`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertStringIncludes(result, "../lib/util-bag.js");
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
      assertStringIncludes(result, "../lib/uses-crypto.js");
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

      // Only the string survives, so the import kept no binding.
      assertEquals(occurrences(result, "hashOf"), 1);
      assertStringIncludes(result, `"hashOf"`);
      assertStringIncludes(result, "../lib/uses-crypto.js");
    });

    it("does not count a template literal mention", async () => {
      const code = [
        'import { hashOf } from "../lib/uses-crypto.js";',
        'export async function getServerData() { return hashOf("x"); }',
        "export default function Page() { return `hashOf`; }",
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertEquals(occurrences(result, "hashOf"), 1);
      assertStringIncludes(result, "../lib/uses-crypto.js");
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
      assertStringIncludes(result, "../lib/uses-crypto.js");
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

    it("leaves a local aliased to a hook name alone beside a real hook", async () => {
      const code = [
        `function other() { return computeOnClient(); }`,
        `export { other as getServerData };`,
        `export function getStaticData() { return readSecret(); }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code);

      assertNotIncludes(result, "readSecret");
      assertStringIncludes(result, "computeOnClient");
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
      assertStringIncludes(result, "@/lib/uses-crypto");
      assertStringIncludes(result, "TestD as default");
    });

    it("does not run for the ssr target", () => {
      assertEquals(browserServerExportsStripPlugin.condition?.(ctx("", "ssr")), false);
      assertEquals(browserServerExportsStripPlugin.condition?.(ctx("", "browser")), true);
    });
  });
});
