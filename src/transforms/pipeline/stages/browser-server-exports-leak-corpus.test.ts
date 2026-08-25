import "#veryfront/schemas/_test-setup.ts";
import "../../plugins/__tests__/code-parser-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { stripServerOnlyExports } from "./browser-server-exports-strip.ts";

function assertNotIncludes(haystack: string, needle: string): void {
  assertEquals(haystack.includes(needle), false, `expected not to find ${needle} in:\n${haystack}`);
}

/** The esbuild keepNames shape from veryfront-code#3846's leak-probe corpus. */
function keepNamesModule(clientLine: string): string {
  return [
    `import { getEnv } from "veryfront";`,
    `import { db } from "../lib/server/db.ts";`,
    `var __defProp = Object.defineProperty;`,
    `var __name = (target, value) => __defProp(target, "name", { value, configurable: true });`,
    `const API_KEY = getEnv("ORDERS_SECRET");`,
    `async function loadUser(id) { return db.query(id, API_KEY); }`,
    `__name(loadUser, "loadUser");`,
    `export async function getServerData(ctx) {`,
    `  return { props: { user: await loadUser(ctx.id) } };`,
    `}`,
    clientLine,
    `export default function Page() { return null; }`,
  ].join("\n");
}

async function assertServerChainRemoved(clientLine: string): Promise<void> {
  const output = await stripServerOnlyExports(keepNamesModule(clientLine), "pages/orders.tsx");
  assertNotIncludes(output, "../lib/server/db.ts");
  assertNotIncludes(output, "ORDERS_SECRET");
}

describe("browser server-exports leak corpus", () => {
  describe("veryfront-code#3846 keepNames-shaped server-chain probes", () => {
    const stripRows: Array<[string, string]> = [
      ['typeof v === "object"', `const isPlain = (v) => typeof v === "object";`],
      ["v?.constructor === Object", `const isPlain = (v) => v?.constructor === Object;`],
      ["e.constructor.name", `const label = (e) => e.constructor.name;`],
      ["v.__proto__", `const proto = (v) => v.__proto__;`],
      ["v instanceof Function", `const isFn = (v) => v instanceof Function;`],
      ["typeof eval", `const hasEval = typeof eval;`],
      ["__name reassigned", `__name = (target, value) => target;`],
      // The #3846 body names `Obj2`; the historical 991e3096b fixture used
      // a module-scope `Object` alias. Keep the body row here so the corpus
      // matches the disposition note rather than broadening it.
      ["const Obj2 = globalThis.Object", `const Obj2 = globalThis.Object;`],
      ["globalThis.Object = Object", `globalThis.Object = Object;`],
    ];

    for (const [label, clientLine] of stripRows) {
      it(`removes the server chain for ${label}`, async () => {
        await assertServerChainRemoved(clientLine);
      });
    }

    it("rejects a duplicate compiler name helper instead of retaining the server chain", async () => {
      const error = await assertRejects(() =>
        stripServerOnlyExports(
          keepNamesModule(`var __name = (target, value) => target;`),
          "pages/orders.tsx",
        )
      );

      assertStringIncludes(
        (error as Error).message,
        "compiler name helper `__name` is declared more than once",
      );
      assertStringIncludes((error as Error).message, "pages/orders.tsx");
    });

    it("rejects a duplicated defineProperty alias instead of deleting a browser registration", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `import { db } from "../lib/server/db.ts";`,
        `var d = Object.defineProperty;`,
        `var n = (target, value) => d(target, "name", { value, configurable: true });`,
        `function registerClient(target) { globalThis.registered = target; return target; }`,
        `var d = registerClient;`,
        `const API_KEY = getEnv("ORDERS_SECRET");`,
        `async function loadUser(id) { return db.query(id, API_KEY); }`,
        `n(loadUser, "loadUser");`,
        `export async function getServerData(ctx) {`,
        `  return { props: { user: await loadUser(ctx.id) } };`,
        `}`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() => stripServerOnlyExports(code, "pages/orders.tsx"));

      assertStringIncludes(
        (error as Error).message,
        "compiler name helper `n` uses defineProperty alias `d` declared more than once",
      );
    });

    it("rejects an ambiguous helper whose target becomes hook-only while pruning", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `import { db } from "../lib/server/db.ts";`,
        `var __defProp = Object.defineProperty;`,
        `var __name = (target, value) => __defProp(target, "name", { value, configurable: true });`,
        `function registerClient(target) { globalThis.registered = target; return target; }`,
        `const API_KEY = getEnv("ORDERS_SECRET");`,
        `function inner(id) { return db.query(id, API_KEY); }`,
        `function outer(id) { return inner(id); }`,
        `__name(inner, "inner");`,
        `var __name = registerClient;`,
        `export async function getServerData(ctx) {`,
        `  return { props: { u: await outer(ctx.id) } };`,
        `}`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() => stripServerOnlyExports(code, "pages/orders.tsx"));

      assertStringIncludes(
        (error as Error).message,
        "compiler name helper `__name` is declared more than once",
      );
      assertStringIncludes((error as Error).message, "pages/orders.tsx");
    });

    it("rejects an ambiguous helper even when a valid helper also registers the hook-only target", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `import { db } from "../lib/server/db.ts";`,
        `var d = Object.defineProperty;`,
        `var n = (target, value) => d(target, "name", { value, configurable: true });`,
        `var m = (target, value) => d(target, "name", { value, configurable: true });`,
        `function registerClient(target) { globalThis.registered = target; return target; }`,
        `var n = registerClient;`,
        `const API_KEY = getEnv("ORDERS_SECRET");`,
        `async function loadUser(id) { return db.query(id, API_KEY); }`,
        `n(loadUser, "loadUser");`,
        `m(loadUser, "loadUser");`,
        `export async function getServerData(ctx) {`,
        `  return { props: { user: await loadUser(ctx.id) } };`,
        `}`,
        `export default function Page() { return null; }`,
      ].join("\n");

      const error = await assertRejects(() => stripServerOnlyExports(code, "pages/orders.tsx"));

      assertStringIncludes(
        (error as Error).message,
        "compiler name helper `n` is declared more than once",
      );
      assertStringIncludes((error as Error).message, "pages/orders.tsx");
    });

    it("does not reject a duplicate helper when its registered target is still browser-read", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `var __defProp = Object.defineProperty;`,
        `var __name = (target, value) => __defProp(target, "name", { value, configurable: true });`,
        `function format(v) { return String(v); }`,
        `__name(format, "format");`,
        `var __name = (target, value) => target;`,
        `export async function getServerData() { return { props: { k: getEnv("K"), f: format(1) } }; }`,
        `export default function Page() { return format(2); }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/orders.tsx");

      assertStringIncludes(result, "function format(v)");
      assertNotIncludes(result, `getEnv("K")`);
    });

    it("does not reject mixed helper registrations when the target is still browser-read", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `var d = Object.defineProperty;`,
        `var n = (target, value) => d(target, "name", { value, configurable: true });`,
        `var m = (target, value) => d(target, "name", { value, configurable: true });`,
        `function registerClient(target) { globalThis.registered = target; return target; }`,
        `var n = registerClient;`,
        `function format(v) { return String(v); }`,
        `n(format, "format");`,
        `m(format, "format");`,
        `export async function getServerData() { return { props: { k: getEnv("K"), f: format(1) } }; }`,
        `export default function Page() { return format(2); }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/orders.tsx");

      assertStringIncludes(result, `n(format, "format")`);
      assertStringIncludes(result, `m(format, "format")`);
      assertStringIncludes(result, "function format(v)");
      assertNotIncludes(result, `getEnv("K")`);
    });

    it("keeps an ambiguous defineProperty-alias registration for a browser-read target", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `var d = Object.defineProperty;`,
        `var n = (target, value) => d(target, "name", { value, configurable: true });`,
        `function registerClient(target) { globalThis.registered = target; return target; }`,
        `var d = registerClient;`,
        `function format(v) { return String(v); }`,
        `n(format, "format");`,
        `export async function getServerData() { return { props: { k: getEnv("K") } }; }`,
        `export default function Page() { return format(2); }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/orders.tsx");

      assertStringIncludes(result, `n(format, "format")`);
      assertStringIncludes(result, "function format(v)");
      assertNotIncludes(result, `getEnv("K")`);
    });

    it("does not reject an unrelated duplicated callable helper", async () => {
      const code = [
        `import { getEnv } from "veryfront";`,
        `var register = (target, value) => target;`,
        `function format(v) { return String(v); }`,
        `register(format, "format");`,
        `var register = (target, value) => target;`,
        `export async function getServerData() { return { props: { k: getEnv("K") } }; }`,
        `export default function Page() { return format(2); }`,
      ].join("\n");

      const result = await stripServerOnlyExports(code, "pages/orders.tsx");

      assertStringIncludes(result, "function format(v)");
      assertNotIncludes(result, `getEnv("K")`);
    });
  });
});
