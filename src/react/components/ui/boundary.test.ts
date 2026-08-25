import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { walk } from "@std/fs/walk";
import { parse } from "npm:@babel/parser@7.29.2";

// `veryfront/ui` is the base layer: `chat` depends on `ui`, never the reverse.
// This test enforces that contract so a stray import back into `chat/` can't
// silently reintroduce the dependency (regression guard for PR #2798).
const UI_DIR = new URL(".", import.meta.url).pathname;

/** Collect every module specifier a source file references. */
function moduleSpecifiers(source: string): string[] {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx", "decorators-legacy", "importAttributes"],
  });
  const found: Array<{ start: number; specifier: string }> = [];

  function collectDynamicSpecifier(value: unknown, start: number): void {
    if (value === null || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node.type === "StringLiteral" && typeof node.value === "string") {
      found.push({ start, specifier: node.value });
      return;
    }
    if (
      node.type === "TemplateLiteral" && Array.isArray(node.expressions) &&
      node.expressions.length === 0 && Array.isArray(node.quasis)
    ) {
      const quasi = node.quasis[0] as Record<string, unknown> | undefined;
      const quasiValue = quasi?.value as Record<string, unknown> | undefined;
      const specifier = quasiValue?.cooked ?? quasiValue?.raw;
      if (typeof specifier === "string") found.push({ start, specifier });
    }
  }

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (value === null || typeof value !== "object") return;

    const node = value as Record<string, unknown>;
    const type = node.type;
    if (
      (type === "ImportDeclaration" || type === "ExportNamedDeclaration" ||
        type === "ExportAllDeclaration") &&
      node.source && typeof node.source === "object"
    ) {
      const sourceNode = node.source as Record<string, unknown>;
      if (typeof sourceNode.value === "string") {
        found.push({ start: Number(node.start ?? 0), specifier: sourceNode.value });
      }
    } else if (type === "CallExpression" && node.callee && typeof node.callee === "object") {
      const callee = node.callee as Record<string, unknown>;
      const argument = Array.isArray(node.arguments) ? node.arguments[0] : undefined;
      if (callee.type === "Import") collectDynamicSpecifier(argument, Number(node.start ?? 0));
    } else if (type === "ImportExpression") {
      collectDynamicSpecifier(node.source, Number(node.start ?? 0));
    }

    for (const child of Object.values(node)) visit(child);
  }

  visit(ast.program);
  return found.sort((a, b) => a.start - b.start).map(({ specifier }) => specifier);
}

function referencesChat(specifier: string): boolean {
  return (
    specifier.includes("components/chat") ||
    specifier.startsWith("../chat/") ||
    specifier.startsWith("../../chat/")
  );
}

// RFC 0001 §6.6 + issue #220: the core `veryfront/ui` depends on NO UI-primitive
// engine. Reference adapters (Base UI, Radix, React Aria, Ariakit) are vendored
// CLI templates the consumer owns: the engine is *their* dependency, never
// core's. This guard fails loudly if an engine import ever leaks into `ui/**`.
const ENGINE_SPECIFIER =
  /@base-ui|@base-ui-components|(^|\/)react-aria|react-aria-components|@react-aria|@react-stately|@radix-ui|(^|\/)radix-ui|@ariakit|@zag-js|@ark-ui/;

describe("veryfront/ui module boundary", () => {
  it("scans static, side-effect, and dynamic import specifiers", () => {
    assertEquals(
      moduleSpecifiers('import { a } from "../chat/x.ts";'),
      ["../chat/x.ts"],
      "static imports are scanned",
    );
    assertEquals(
      moduleSpecifiers('const m = import("../chat/x.ts");'),
      ["../chat/x.ts"],
      "dynamic imports are scanned",
    );
    assertEquals(
      moduleSpecifiers('import "../chat/x.ts";'),
      ["../chat/x.ts"],
      "side-effect imports are scanned",
    );
    assertEquals(
      moduleSpecifiers('export { a } from "../chat/x.ts";'),
      ["../chat/x.ts"],
      "re-exports are scanned",
    );
    assertEquals(
      moduleSpecifiers("const m = import(`../chat/x.ts`);"),
      ["../chat/x.ts"],
      "static template-literal imports are scanned",
    );
    assertEquals(
      moduleSpecifiers('const m = import(/* @vite-ignore */ "../chat/x.ts");'),
      ["../chat/x.ts"],
      "comments inside dynamic imports do not hide specifiers",
    );
    assertEquals(
      moduleSpecifiers('import /* webpackChunkName: "chat" */ "../chat/x.ts";'),
      ["../chat/x.ts"],
      "comments inside side-effect imports do not hide specifiers",
    );
  });

  it("does not import anything from the chat module", async () => {
    const offenders: string[] = [];

    for await (
      const entry of walk(UI_DIR, {
        exts: [".ts", ".tsx"],
        includeDirs: false,
      })
    ) {
      if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
      const source = await Deno.readTextFile(entry.path);
      for (const specifier of moduleSpecifiers(source)) {
        if (referencesChat(specifier)) {
          offenders.push(`${entry.name} -> ${specifier}`);
        }
      }
    }

    assertEquals(
      offenders,
      [],
      `ui/** must not import chat internals:\n  - ${offenders.join("\n  - ")}`,
    );
  });

  it("core imports no third-party UI-primitive engine (adapters are vendored templates)", async () => {
    const offenders: string[] = [];

    for await (
      const entry of walk(UI_DIR, {
        exts: [".ts", ".tsx"],
        includeDirs: false,
      })
    ) {
      if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
      const source = await Deno.readTextFile(entry.path);
      for (const specifier of moduleSpecifiers(source)) {
        if (ENGINE_SPECIFIER.test(specifier)) {
          offenders.push(`${entry.name} -> ${specifier}`);
        }
      }
    }

    assertEquals(
      offenders,
      [],
      `ui/** must depend on no primitive engine: vendor a reference adapter instead:\n  - ${
        offenders.join("\n  - ")
      }`,
    );
  });

  it("guards against the exact chat-tokens back-import that regressed before", async () => {
    // AppShell used to import `ChatTokens` from chat; the token layer now lives
    // in `ui/tokens.tsx`. Assert the offending import string is gone.
    const appShell = await Deno.readTextFile(`${UI_DIR}app-shell.tsx`);
    assert(
      !appShell.includes("chat-tokens-style"),
      "app-shell.tsx must render the local ui token style, not chat's",
    );
  });
});
