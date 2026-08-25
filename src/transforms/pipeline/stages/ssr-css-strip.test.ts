import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { stop as stopEsbuild } from "#veryfront/platform/compat/esbuild.ts";
import { compilePlugin } from "./compile.ts";
import type { TransformContext } from "../types.ts";
import { __maskCommentQuotesForModuleLexer, cssStripPlugin } from "./ssr-css-strip.ts";
import {
  getCssModuleScope,
  resolveCssModuleKey,
  rewriteCssModuleContent,
  toScopedCssModuleClass,
} from "#veryfront/transforms/css-modules/naming.ts";
import { encodeBase64Bytes } from "#veryfront/utils/base64url.ts";

const MODULE_KEY = resolveCssModuleKey(
  "./Button.module.css",
  "/project/pages/index.tsx",
  "/project",
);

function moduleDataUrl(source: string): string {
  const encoded = encodeBase64Bytes(new TextEncoder().encode(source));
  return `data:text/javascript;base64,${encoded}`;
}

function createContext(code: string, dev = true): TransformContext {
  return {
    code,
    originalSource: code,
    filePath: "/project/pages/index.tsx",
    projectDir: "/project",
    projectId: "project",
    target: "ssr",
    dev,
    contentHash: "hash",
    jsxImportSource: "react",
    timing: new Map(),
    debug: false,
    metadata: new Map(),
    reactVersion: "19.1.1",
  } as TransformContext;
}

function allPrivateUseSentinelCandidates(): string {
  let candidates = "";
  for (
    const [first, last] of [
      [0xe000, 0xf8ff],
      [0xf0000, 0xffffd],
      [0x100000, 0x10fffd],
    ] as const
  ) {
    for (let codePoint = first; codePoint <= last; codePoint++) {
      candidates += String.fromCodePoint(codePoint);
    }
  }
  return candidates;
}

/**
 * SSR stubs are linked as real ES modules, so the only assertion that catches a
 * syntactically invalid stub is asking a JS engine to parse it.
 */
async function assertParsesAsModule(source: string, message: string): Promise<void> {
  let parseError: string | undefined;
  try {
    await import(moduleDataUrl(source));
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }
  assertEquals(parseError, undefined, `${message} (got: ${parseError})`);
}

/**
 * Link and evaluate a stubbed SSR module and hand back its export namespace.
 *
 * Whether a stub still *carries* a binding is only half the contract: an
 * importer reads through it, so the shape it hands back has to be checked by
 * running the module rather than by matching its text.
 */
async function evaluateModule(source: string): Promise<Record<string, unknown>> {
  const namespace = await import(moduleDataUrl(source));
  return namespace as Record<string, unknown>;
}

describe("css-strip plugin", () => {
  it("rewrites dynamic css imports to a valid expression stub", async () => {
    const ctx = createContext(
      `async function load(){ const styles = await import("./Button.module.css"); return styles.default.container; }`,
    );

    const result = await cssStripPlugin.transform(ctx);

    assertEquals(result.includes(`import("./Button.module.css")`), false);
    assertEquals(result.includes("await /* css import"), false);
    const scope = getCssModuleScope(MODULE_KEY);
    assertStringIncludes(
      result,
      'await Promise.resolve({ default: new Proxy({}, { get: (_, p) => typeof p === "string" ? "Button_"',
      "a dynamic css module import must become a scoped proxy stub",
    );
    assertStringIncludes(
      result,
      `+ "__${scope.hash}" : "" })`,
      "the dynamic stub must carry the module scope hash resolved from the importer path",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("rewrites static css module imports to scoped class names", async () => {
    const ctx = createContext(
      `import styles, { container as root } from "./Button.module.css"; export const c = styles.container + " " + root;`,
    );

    const result = await cssStripPlugin.transform(ctx);

    const expectedClass = toScopedCssModuleClass(MODULE_KEY, "container");

    assertEquals(result.includes(`import styles`), false);
    assertStringIncludes(
      result,
      "const styles = new Proxy({},",
      "the default css module binding must become a proxy stub",
    );
    assertStringIncludes(
      result,
      `root = "${expectedClass}"`,
      "the named binding must resolve to the scoped class of the importer-resolved module key",
    );
    assertStringIncludes(
      rewriteCssModuleContent(".container { color: red; }", MODULE_KEY),
      `.${expectedClass}`,
      "the emitted class must match the class the aggregated css is rewritten to",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("rewrites css imports whose suffix contains string escapes", async () => {
    for (
      const specifier of [
        String.raw`./Button.module\x2ecss`,
        String.raw`./Button.module.\x63ss`,
        String.raw`./Button.module.c\u0073s`,
        String.raw`./Button.module.cs\u{73}`,
      ] as const
    ) {
      const ctx = createContext(
        `import styles from "${specifier}"; export const cls = styles.container;`,
      );

      const result = await cssStripPlugin.transform(ctx);
      const namespace = await evaluateModule(result);

      assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
      assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
    }
  });

  it("keeps a css re-export exporting the bindings it re-exported", async () => {
    const ctx = createContext(
      `export { default as styles, container as root } from "./Button.module.css";`,
    );

    const result = await cssStripPlugin.transform(ctx);

    assertStringIncludes(
      result,
      "const __vfCssExport_0 = new Proxy({},",
      "a re-exported css default must be backed by a scoped proxy stub",
    );
    assertStringIncludes(
      result,
      "export { __vfCssExport_0 as styles };",
      "a re-exported css default must stay exported under its original name",
    );
    assertStringIncludes(
      result,
      `const __vfCssExport_1 = "${toScopedCssModuleClass(MODULE_KEY, "container")}";`,
      "a re-exported named css binding must be backed by its scoped class",
    );
    assertStringIncludes(
      result,
      "export { __vfCssExport_1 as root };",
      "a re-exported named css binding must stay exported under its original name",
    );
    assertEquals(
      /\bconst\s+(styles|root)\s*=/.test(result),
      false,
      "a css re-export must not declare the export name as a local binding",
    );
    await assertParsesAsModule(
      result,
      "a named css re-export must produce a parseable SSR module",
    );
    assertEquals(
      result.includes(`.module.css"`),
      false,
      "no live .module.css specifier may survive",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("does not redeclare a local that shares its name with a css re-export", async () => {
    const ctx = createContext(
      `const styles = { fallback: true }; export { default as styles } from "./Button.module.css"; export const used = styles.fallback;`,
    );

    const result = await cssStripPlugin.transform(ctx);

    assertEquals(
      (result.match(/\bconst\s+styles\s*=/g) ?? []).length,
      1,
      "the module's own `const styles` must remain the only `styles` declaration",
    );
    assertStringIncludes(
      result,
      "export { __vfCssExport_0 as styles };",
      "the css re-export must still be exported as `styles` through a safe local",
    );
    await assertParsesAsModule(
      result,
      "a css re-export that shadows an existing local must not produce a duplicate declaration",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("exports a reserved-word css re-export name without declaring it", async () => {
    const ctx = createContext(
      `export { container as class } from "./Button.module.css";`,
    );

    const result = await cssStripPlugin.transform(ctx);

    assertEquals(
      /\bconst\s+class\b/.test(result),
      false,
      "a reserved export name must never become a const binding, which cannot parse",
    );
    assertStringIncludes(
      result,
      `const __vfCssExport_0 = "${toScopedCssModuleClass(MODULE_KEY, "container")}";`,
      "the reserved export name must be backed by a safe local binding",
    );
    assertStringIncludes(
      result,
      "export { __vfCssExport_0 as class };",
      "the safe local binding must still be exported under the original export name",
    );
    await assertParsesAsModule(
      result,
      "a reserved-word css re-export must still produce a parseable SSR module",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("exports a reserved-word css namespace re-export without declaring it", async () => {
    const ctx = createContext(`export * as class from "./Button.module.css";`);

    const result = await cssStripPlugin.transform(ctx);

    assertEquals(
      /\bconst\s+class\b/.test(result),
      false,
      "a reserved namespace export name must never become a const binding",
    );
    assertStringIncludes(
      result,
      "const __vfCssExport_0 = ",
      "the reserved namespace export must be backed by a safe local binding",
    );
    assertStringIncludes(
      result,
      "export { __vfCssExport_0 as class };",
      "the safe local proxy stub must be exported under the original export name",
    );
    await assertParsesAsModule(
      result,
      "a reserved-word css namespace re-export must still produce a parseable SSR module",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("gives a css namespace re-export the shape of a module namespace", async () => {
    const ctx = createContext(`export * as styles from "./Button.module.css";`);

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);
    const styles = namespace.styles as Record<string, Record<string, string>>;

    assertEquals(
      styles.default?.container,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a namespace re-export binds the module namespace, so `styles.default` must be the class map",
    );
    assertEquals(
      styles.container as unknown as string,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a css module namespace also exposes each class as a named export",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("keeps a minified css re-export exporting its bindings", async () => {
    // esbuild minifies immediately before this stage whenever `dev` is false,
    // so production statements carry no spaces around `from`.
    const ctx = createContext(
      `export{default as styles,container as root}from"./Button.module.css";`,
    );

    const result = await cssStripPlugin.transform(ctx);

    assertEquals(
      result.includes("css re-export stripped"),
      false,
      "a minified css re-export must not be stripped to a comment, which drops the binding",
    );
    const namespace = await evaluateModule(result);
    assertEquals(
      (namespace.styles as Record<string, string>)?.container,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a minified re-exported css default must still resolve to the scoped class map",
    );
    assertEquals(
      namespace.root,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a minified re-exported named css binding must still resolve to its scoped class",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("does not treat `from` inside a quoted css specifier as the import keyword", async () => {
    const ctx = createContext(
      `import styles from "./from'button.module.css"; export const cls = styles.container;`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);
    const moduleKey = resolveCssModuleKey(
      "./from'button.module.css",
      "/project/pages/index.tsx",
      "/project",
    );

    assertEquals(
      namespace.cls,
      toScopedCssModuleClass(moduleKey, "container"),
      "a quoted specifier containing `from` must keep the default css module binding",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./from'button.module.css"]);
  });

  it("does not treat `from` inside a css import comment as the keyword", async () => {
    const ctx = createContext(
      `const quotePattern = /'/; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export const matched = quotePattern.test("'");`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.cls,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a comment containing a decoy `from` must not hide the real css import clause",
    );
    assertEquals(namespace.matched, true, "masking comments must not alter regex literals");
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("treats division after postfix operators as division while masking comments", async () => {
    const ctx = createContext(
      `let x = 2; const incremented = x++ / 2; const decremented = x-- / 2; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export const value = incremented + decremented;`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.cls,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a division slash after postfix increment must not hide a later css import comment",
    );
    assertEquals(namespace.value, 2.5, "the surrounding division expressions must stay intact");
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("keeps regex backticks inside template interpolations while masking comments", async () => {
    const ctx = createContext(
      'const value = `${/`/.test("`")}`; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { value };',
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.cls,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a regex backtick inside a template interpolation must not hide a later css import comment",
    );
    assertEquals(namespace.value, "true", "the surrounding template expression must stay intact");
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("treats division after a Unicode identifier as division while masking comments", async () => {
    const ctx = createContext(
      `const π = 3; const value = π / 2; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { value };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
    assertEquals(namespace.value, 1.5);
  });

  it("treats division after a standalone `of` binding as division", async () => {
    const ctx = createContext(
      `const of = 4; const value = of / 2; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { value };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.cls,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "`of` used as a binding must not open regex context for the following slash",
    );
    assertEquals(namespace.value, 2);
  });

  it("still opens regex context for `of` in a for-of head", async () => {
    const ctx = createContext(
      `const matches = []; for (const match of /["]/g[Symbol.matchAll]('"x"')) matches.push(match[0]); import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export const count = matches.length;`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
    assertEquals(namespace.count, 2, "a regex literal after for-of `of` must stay a regex");
  });

  it("does not treat a for-of binding named `of` as the separator", async () => {
    const ctx = createContext(
      `const matches = []; for (let of of /[\"]/g[Symbol.matchAll]('\"x\"')) matches.push(of[0]); import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export const count = matches.length;`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
    assertEquals(namespace.count, 2, "only the second `of` must open operand context");
  });

  it("treats `of` as a binding inside a non-`for` control-flow head", async () => {
    const ctx = createContext(
      `const of = 4; let flag = false; if (of / 2) flag = true; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { flag };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.cls,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "`of` inside an `if` head is a binding, not the for-of operator",
    );
    assertEquals(
      namespace.flag,
      true,
      "the division inside the `if` head must stay executable",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("keeps a comment between `from` and the css specifier linkable", async () => {
    const ctx = createContext(
      `import styles from /* "./decoy.module.css" */ "./Button.module.css"; export const cls = styles.container;`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.cls,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a comment between `from` and the specifier must not drop the default binding",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("allows a regex literal after a `catch` block", async () => {
    const ctx = createContext(
      `const value = "'"; let ok = false; try {} catch (e) {} /[']/u.test(value); ok = true; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { ok };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
    assertEquals(namespace.ok, true);
  });

  it("allows a regex literal after an `else` block", async () => {
    const ctx = createContext(
      `const value = "'"; let ok = false; if (!value) {} else {} /[']/u.test(value); ok = true; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { ok };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.cls,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a regex after an `else` block must not hide the later css import comment",
    );
    assertEquals(namespace.ok, true, "the regex after the `else` block must stay executable");
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("allows a regex literal after a `try`/`finally` block", async () => {
    const ctx = createContext(
      `const value = "'"; let ok = false; try {} finally {} /[']/u.test(value); ok = true; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { ok };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.cls,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a regex after a `finally` block must not hide the later css import comment",
    );
    assertEquals(namespace.ok, true, "the regex after the `finally` block must stay executable");
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("allows a regex literal after a statement block", async () => {
    const ctx = createContext(
      `const value = "'"; let ok = false; if (value) {} /[']/u.test(value); ok = true; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { ok };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.cls,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a regex after a statement block must not trap the scanner in string mode",
    );
    assertEquals(namespace.ok, true, "the regex after the statement block must stay executable");
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("allows a regex literal after an optional-binding `catch` block", async () => {
    const ctx = createContext(
      `const value = "'"; let ok = false; try {} catch {} /[']/u.test(value); ok = true; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { ok };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.cls,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a regex after a binding-less `catch` block must not hide the later css import comment",
    );
    assertEquals(
      namespace.ok,
      true,
      "the regex after the binding-less `catch` block must stay executable",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("allows a regex literal after a `switch` block", async () => {
    const ctx = createContext(
      `const value = "'"; let ok = false; switch (value) { case "'": ok = true; break; } /[']/u.test(value); import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { ok };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.cls,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a regex after a `switch` block must not hide the later css import comment",
    );
    assertEquals(namespace.ok, true, "the `switch` body must stay executable");
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("allows a regex literal after `export default`", async () => {
    const ctx = createContext(
      `const value = "'"; export default /[']/u.test(value); import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container;`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.cls,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a regex after `export default` must not hide the later css import comment",
    );
    assertEquals(
      namespace.default,
      true,
      "the regex exported as the default binding must stay a regex literal",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("treats an export-default object as an operand before division", async () => {
    const ctx = createContext(
      `export default {} / 2; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container;`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assert(Number.isNaN(namespace.default as number));
    assertEquals(
      namespace.cls,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "an export-default object must leave the following slash in division context",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("treats division after a reserved-word private name as division", async () => {
    const ctx = createContext(
      `const value = "'"; class Ratio { #return = 4; half() { return this.#return / 2; } } const half = new Ratio().half(); import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { half, value };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.cls,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a private name spelled as a keyword must not open regex context for the following slash",
    );
    assertEquals(namespace.half, 2, "`this.#return / 2` must stay a division");
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("allows a regex literal after an ASI-terminated `debugger` statement", async () => {
    const ctx = createContext(
      `const value = "'"; let ok = false; debugger\n/[']/u.test(value); ok = true; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { ok };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.cls,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a regex on the line after `debugger` must not hide the later css import comment",
    );
    assertEquals(
      namespace.ok,
      true,
      "the regex after the ASI-terminated statement must stay executable",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("recognizes return ASI before standalone and labelled blocks", async () => {
    for (const separator of ["\n", " /* line terminator\n*/ "] as const) {
      for (const block of ["{}", "outer: {}"] as const) {
        const ctx = createContext(
          `const value = '"'; function run() { return${separator}${block} /["]/u.test(value); } run(); import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container;`,
        );

        const result = await cssStripPlugin.transform(ctx);
        const namespace = await evaluateModule(result);

        assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
        assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
      }
    }
  });

  it("retains ASI-terminated break and continue context through labels", async () => {
    for (
      const statement of [
        'outer: { break outer\n/["]/u.test(value); }',
        'outer: for (let i = 0; i < 1; i++) { continue outer\n/["]/u.test(value); }',
      ]
    ) {
      const ctx = createContext(
        `const value = '"'; ${statement} import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container;`,
      );

      const result = await cssStripPlugin.transform(ctx);
      const namespace = await evaluateModule(result);

      assertEquals(
        namespace.cls,
        toScopedCssModuleClass(MODULE_KEY, "container"),
        `${statement} must leave the next line in regex context`,
      );
      assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
    }
  });

  it("finishes restricted ASI statements at line terminators inside block comments", async () => {
    for (
      const statement of [
        'debugger /*\n*/ /["]/u.test(value);',
        'outer: { break outer /*\n*/ /["]/u.test(value); }',
        'outer: for (let i = 0; i < 1; i++) { continue outer /*\n*/ /["]/u.test(value); }',
      ]
    ) {
      const ctx = createContext(
        `const value = '\"'; ${statement} import styles /* from \"./decoy.module.css\" */ from \"./Button.module.css\"; export const cls = styles.container;`,
      );

      const result = await cssStripPlugin.transform(ctx);
      const namespace = await evaluateModule(result);

      assertEquals(
        namespace.cls,
        toScopedCssModuleClass(MODULE_KEY, "container"),
        `${statement} must leave the next token in regex context`,
      );
      assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
    }
  });

  it("keeps an optional break label through its ASI line terminator", async () => {
    const ctx = createContext(
      `const value = '"'; outer: { break outer\n/[\"]/u.test(value); } import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container;`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.cls,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a break label must not hide the later css import comment after ASI",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("masks comments after a line comment terminates a labelled break", () => {
    const { masked } = __maskCommentQuotesForModuleLexer(
      `const value = '\"'; outer: { break outer // the label ends on this line
/[\"]/u.test(value); } import styles /* from \"./decoy.module.css\" */ from \"./Button.module.css\";`,
    );

    assertEquals(masked.includes('/* from "./decoy.module.css" */'), false);
    assertEquals(masked.includes('from "./Button.module.css";'), true);
  });

  it("masks comments after a block comment terminates a labelled continue", () => {
    const { masked } = __maskCommentQuotesForModuleLexer(
      `const value = '\"'; outer: for (;;) { continue outer /* the label ends here
*/ /[\"]/u.test(value); } import styles /* from \"./decoy.module.css\" */ from \"./Button.module.css\";`,
    );

    assertEquals(masked.includes('/* from "./decoy.module.css" */'), false);
    assertEquals(masked.includes('from "./Button.module.css";'), true);
  });

  it("keeps a line comment between `from` and the css specifier linkable", async () => {
    const ctx = createContext(
      `import styles from // "./decoy.module.css"\n"./Button.module.css"; export const cls = styles.container;`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.cls,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a line comment between `from` and the specifier must not drop the default binding",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("keeps a comment between a css re-export `from` and its specifier linkable", async () => {
    const ctx = createContext(
      `export { default as styles } from /* "./decoy.module.css" */ "./Button.module.css";`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      (namespace.styles as Record<string, string>).container,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a comment before a re-exported css specifier must not drop the re-exported binding",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("treats division after an object literal as division while masking comments", async () => {
    const ctx = createContext(
      `const value = { valueOf: () => 8 } / 2; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { value };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.cls,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "an object literal closing brace must keep the following slash a division operator",
    );
    assertEquals(namespace.value, 4, "the division after the object literal must stay executable");
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("allows a regex literal after a declaration body", async () => {
    const ctx = createContext(
      `const value = '"'; function f() {} /["]/u.test(value); const ok = true; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { ok };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
    assertEquals(namespace.ok, true);
  });

  it("keeps declaration body tracking through nested header braces", async () => {
    for (
      const declaration of [
        "function f(options = {}) {}",
        "function f(options = { function: true, class: true }) {}",
        "class Declared extends (class { static options = { function: true, class: true }; }) {}",
      ]
    ) {
      const ctx = createContext(
        `const value = '"'; ${declaration} /["]/u.test(value); import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container;`,
      );

      const result = await cssStripPlugin.transform(ctx);
      const namespace = await evaluateModule(result);

      assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
      assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
    }
  });

  it("does not treat keyword-named class fields as nested bodies", async () => {
    const ctx = createContext(
      `class FieldNames { function; class; } const ratio = {} / 2; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { ratio };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
    assert(Number.isNaN(namespace.ratio as number));
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("does not treat an import-named class field as a static import", async () => {
    const ctx = createContext(
      `class Fields { import = {} / 2; } const ratio = new Fields().import; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { ratio };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assert(Number.isNaN(namespace.ratio as number));
    assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("drops semicolonless keyword-field body trackers with their class", async () => {
    const ctx = createContext(
      `class Fields { function\nclass\n} const value = '"'; if (true) {} /["]/u.test(value); import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { Fields };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(typeof namespace.Fields, "function");
    assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("does not treat a semicolonless class-named field as a class head", () => {
    const { masked } = __maskCommentQuotesForModuleLexer(
      `class Fields { class\nvalue = {} / 2 } import styles /* from "./decoy.module.css" */ from "./Button.module.css";`,
    );

    assertStringIncludes(
      masked,
      "value = {} / 2",
      "a class-named field must leave the next field's initializer division unmasked",
    );
    assertEquals(
      masked.includes('"./decoy.module.css"'),
      false,
      "a class-named field must not leave css comment quotes unmasked",
    );
  });

  it("does not treat a semicolonless function-named field as a function head", () => {
    const { masked } = __maskCommentQuotesForModuleLexer(
      `class Fields { function\nvalue = foo()\nother = {} / 2 } import styles /* from "./decoy.module.css" */ from "./Button.module.css";`,
    );

    assertStringIncludes(
      masked,
      "other = {} / 2",
      "a function-named field must not turn a later field initializer into a declaration body",
    );
    assertEquals(
      masked.includes('"./decoy.module.css"'),
      false,
      "a stale function body tracker must not leave CSS comment quotes unmasked",
    );
  });

  it("does not consume an object initializer as a semicolonless class field body", async () => {
    const ctx = createContext(
      `class Fields { class\nvalue = {} / 2 } const ratio = new Fields().value; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { ratio };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assert(Number.isNaN(namespace.ratio as number));
    assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("keeps class-field initializer expressions out of class-element tracking", async () => {
    const ctx = createContext(
      `const foo = { bar: 4 }; class Fields { property = foo.bar / 2; sync = function() {} / 2; } const fields = new Fields(); import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export const property = fields.property; export const sync = fields.sync;`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(namespace.property, 2);
    assert(Number.isNaN(namespace.sync as number));
    assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("does not track keyword names inside module specifier lists as bodies", async () => {
    const ctx = createContext(
      `export { class as x } from "./dep.js"; const ratio = {} / 2; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { ratio };`,
    );

    const result = await cssStripPlugin.transform(ctx);

    assertStringIncludes(result, `export { class as x } from "./dep.js"`);
    assertStringIncludes(result, `const ratio = {} / 2`);
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("tracks a mixed import's named bindings as module specifiers", async () => {
    for (const defaultBinding of ["d", "from"] as const) {
      const ctx = createContext(
        `import ${defaultBinding}, { class as x } from "./dep.js"; const value = '"'; if (true) {} /["]/u.test(value); import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { ${defaultBinding}, x };`,
      );

      const result = await cssStripPlugin.transform(ctx);

      assertStringIncludes(
        result,
        `import ${defaultBinding}, { class as x } from "./dep.js"`,
      );
      assertStringIncludes(result, `if (true) {} /["]/u.test(value)`);
      assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
    }
  });

  it("reopens statement context after semicolonless module sources", async () => {
    for (
      const { declaration, localExport, exportName } of [
        {
          declaration: `import dep from "data:text/javascript,export default 1"`,
          localExport: "export { dep };",
          exportName: "dep",
        },
        {
          declaration: `import "data:text/javascript,"`,
          localExport: "",
          exportName: undefined,
        },
        {
          declaration: `export { default as dep } from "data:text/javascript,export default 1"`,
          localExport: "",
          exportName: "dep",
        },
        {
          declaration: `export * from "data:text/javascript,export const helper=1"`,
          localExport: "",
          exportName: "helper",
        },
      ] as const
    ) {
      const ctx = createContext(
        `const value = '"'; ${declaration}\n/["]/u.test(value); import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; ${localExport}`,
      );

      const result = await cssStripPlugin.transform(ctx);
      const namespace = await evaluateModule(result);

      if (exportName !== undefined) assertEquals(namespace[exportName], 1);
      assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
      assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
    }
  });

  it("does not treat an ordinary top-level `from` as a module source", async () => {
    const ctx = createContext(
      `const from = 1; from\n"x" / 2; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { from };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(namespace.from, 1);
    assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("reopens statement context after import attribute objects", async () => {
    for (
      const declaration of [
        `import dep from "data:application/json,1" with { type: "json" }`,
        `export { default as dep } from "data:application/json,1" with { type: "json" }`,
        `import dep from "data:application/json,1" assert { type: "json" }`,
        `export { default as dep } from "data:application/json,1" assert { type: "json" }`,
      ] as const
    ) {
      const ctx = createContext(
        `const value = '"'; ${declaration}\n/["]/u.test(value); import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container;`,
      );

      const result = await cssStripPlugin.transform(ctx);

      assertStringIncludes(result, declaration);
      assertStringIncludes(result, `/["]/u.test(value)`);
      assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
    }
  });

  it("treats function and class expressions as operands before division", async () => {
    for (
      const { expression, expectedRatio } of [
        { expression: "function named() {}", expectedRatio: Number.NaN },
        { expression: "function named()\n{}", expectedRatio: Number.NaN },
        { expression: "function named(options = {}) {}", expectedRatio: Number.NaN },
        {
          expression: "function named(options = { function: true, class: true }) {}",
          expectedRatio: Number.NaN,
        },
        {
          expression: "class Named { static [Symbol.toPrimitive]() { return 9; } }",
          expectedRatio: 4.5,
        },
        {
          expression: "class Named\n{ static [Symbol.toPrimitive]() { return 9; } }",
          expectedRatio: 4.5,
        },
        {
          expression:
            "class Named extends (class { static options = { function: true, class: true }; }) { static [Symbol.toPrimitive]() { return 9; } }",
          expectedRatio: 4.5,
        },
      ]
    ) {
      const ctx = createContext(
        `const ratio = ${expression} / 2; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { ratio };`,
      );

      const result = await cssStripPlugin.transform(ctx);
      const namespace = await evaluateModule(result);

      assertEquals(
        namespace.cls,
        toScopedCssModuleClass(MODULE_KEY, "container"),
        `${expression} must leave the following slash in division context`,
      );
      if (Number.isNaN(expectedRatio)) {
        assert(Number.isNaN(namespace.ratio as number));
      } else {
        assertEquals(namespace.ratio, expectedRatio);
      }
      assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
    }
  });

  it("treats standalone and labelled blocks as statement context before regex", async () => {
    for (const block of ["{}", "outer: {}"] as const) {
      const ctx = createContext(
        `const value = '\"'; ${block} /[\"]/u.test(value); import styles /* from \"./decoy.module.css\" */ from \"./Button.module.css\"; export const cls = styles.container;`,
      );

      const result = await cssStripPlugin.transform(ctx);
      const namespace = await evaluateModule(result);

      assertEquals(
        namespace.cls,
        toScopedCssModuleClass(MODULE_KEY, "container"),
        `${block} must leave the following slash in regex context`,
      );
      assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
    }
  });

  it("treats standalone blocks inside concise methods as statement context", async () => {
    for (
      const declaration of [
        `class Container { method() { {} /["]/u.test(value); } }`,
        `const Container = { method() { {} /["]/u.test(value); } };`,
      ] as const
    ) {
      const ctx = createContext(
        `const value = '"'; ${declaration} import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { Container };`,
      );

      const result = await cssStripPlugin.transform(ctx);
      const namespace = await evaluateModule(result);

      assertEquals(
        typeof namespace.Container,
        declaration.startsWith("class") ? "function" : "object",
      );
      assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
      assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
    }
  });

  it("treats standalone blocks inside arrow bodies as statement context", async () => {
    for (const block of ["{}", "labelled: {}"] as const) {
      const ctx = createContext(
        `const value = '"'; const matches = () => { ${block} /["]/u.test(value); }; matches(); import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container;`,
      );

      const result = await cssStripPlugin.transform(ctx);
      const namespace = await evaluateModule(result);

      assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
      assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
    }
  });

  it("keeps parenthesized arrow expression bodies in operand context", async () => {
    const ctx = createContext(
      `const createValue = () => ({ value: 1 }); import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const value = createValue().value; export const cls = styles.container;`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(namespace.value, 1);
    assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("closes a block-bodied arrow as an operand before division", async () => {
    const ctx = createContext(
      `const ratio = (() => {}) / 2; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { ratio };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assert(Number.isNaN(namespace.ratio as number));
    assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("treats class static initialization blocks as statement blocks", async () => {
    for (const block of ["{}", "labelled: {}"] as const) {
      const ctx = createContext(
        `const value = '"'; class WithStatic { static { ${block} /["]/u.test(value); } } import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { WithStatic };`,
      );

      const result = await cssStripPlugin.transform(ctx);
      const namespace = await evaluateModule(result);

      assertEquals(
        namespace.cls,
        toScopedCssModuleClass(MODULE_KEY, "container"),
        `a static block containing ${block} must leave the following slash in regex context`,
      );
      assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
    }
  });

  it("recognizes ASI before standalone and labelled blocks", async () => {
    for (const block of ["{}", "outer: {}"] as const) {
      const ctx = createContext(
        `const value = '"'; const foo = () => 0; foo()\n${block} /["]/u.test(value); import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container;`,
      );

      const result = await cssStripPlugin.transform(ctx);
      const namespace = await evaluateModule(result);

      assertEquals(
        namespace.cls,
        toScopedCssModuleClass(MODULE_KEY, "container"),
        `ASI before ${block} must leave the following slash in regex context`,
      );
      assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
    }
  });

  it("recognizes ASI before function and class declarations", async () => {
    for (
      const declaration of [
        "function declared() {}",
        "class Declared {}",
        "async function declaredAsync() {}",
        "export function exported() {}",
        "export class Exported {}",
        "export default async function declaredDefaultAsync() {}",
      ] as const
    ) {
      const ctx = createContext(
        `const value = '"'; const foo = () => 0; foo()\n${declaration} /["]/u.test(value); import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container;`,
      );

      const result = await cssStripPlugin.transform(ctx);
      const namespace = await evaluateModule(result);

      assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
      assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
    }
  });

  it("treats a bare yield line terminator as statement context", async () => {
    const ctx = createContext(
      `const value = '"'; function* generate() { yield\n{} /["]/u.test(value); } generate().next(); import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container;`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("treats blocks after switch clause colons as statement context", async () => {
    for (
      const clause of [
        'case "value"',
        "case value?.length",
        'case value ?? "fallback"',
        'case true ? value : "fallback"',
        "case true ? { value: 1 } : 42",
        "default",
      ] as const
    ) {
      const ctx = createContext(
        `const value = \"value\"; switch (value) { ${clause}: {} /[\"]/u.test(value); break; } import styles /* from \"./decoy.module.css\" */ from \"./Button.module.css\"; export const cls = styles.container;`,
      );

      const result = await cssStripPlugin.transform(ctx);
      const namespace = await evaluateModule(result);

      assertEquals(
        namespace.cls,
        toScopedCssModuleClass(MODULE_KEY, "container"),
        `${clause}: must leave the following block in statement context`,
      );
      assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
    }
  });

  it("preserves an outer switch clause while scanning a nested switch", async () => {
    const ctx = createContext(
      `const value = '"'; switch (1) { case (() => { switch (1) { case 1: return 1; } return 2; })(): {} /["]/u.test(value); break; } import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container;`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("ignores property names inside switch clause expressions", async () => {
    for (const property of ["case", "default"] as const) {
      const ctx = createContext(
        `const value = '"'; const f = (x) => x; const obj = { case: 1, default: 2 }; switch (f(obj.${property})) { case f(obj.${property}): {} /["]/u.test(value); break; } import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container;`,
      );

      const result = await cssStripPlugin.transform(ctx);
      const namespace = await evaluateModule(result);

      assertEquals(
        namespace.cls,
        toScopedCssModuleClass(MODULE_KEY, "container"),
        `a property named ${property} must not move the real clause colon out of statement context`,
      );
      assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
    }
  });

  it("keeps labelled else bodies in statement context", async () => {
    const ctx = createContext(
      `const value = '"'; if (true) {} else label: {} /["]/u.test(value); import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container;`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("keeps escaped break labels through their ASI terminator", async () => {
    for (const escapedLabel of ["out\\u0065r", "\\u006futer"]) {
      const ctx = createContext(
        `const value = '"'; outer: { break ${escapedLabel}\n /["]/u.test(value); } import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container;`,
      );

      const result = await cssStripPlugin.transform(ctx);
      const namespace = await evaluateModule(result);

      assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
      assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
    }
  });

  it("retains a class body through tagged-template heritage expressions", async () => {
    const ctx = createContext(
      'const value = "\\""; const tag = () => class {}; class C extends tag`${{}}` {} /["]/u.test(value); import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { C };',
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
    assertEquals(typeof namespace.C, "function");
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("does not consume object-literal heritage as a class body", () => {
    const { masked } = __maskCommentQuotesForModuleLexer(
      `const value = '"'; class C extends { constructor: Object }.constructor { method() {} } /["]/u.test(value); import styles /* from "./decoy.module.css" */ from "./Button.module.css";`,
    );

    assertStringIncludes(
      masked,
      `class C extends { constructor: Object }.constructor { method() {} }`,
      "object-literal heritage must not consume the pending class body",
    );
    assertEquals(
      masked.includes('/* from "./decoy.module.css" */'),
      false,
      "the scanner must still mask comment quotes after the real class body",
    );
  });

  it("retains semicolonless class fields after direct object-literal heritage", async () => {
    const ctx = createContext(
      `const unused = () => { class C extends {} { class\nextends = {} / 2 } return C; }; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { unused };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
    assertEquals(typeof namespace.unused, "function");
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("retains direct object-literal heritage inside a template expression", async () => {
    const ctx = createContext(
      'const unused = () => `${class extends {} { class\nextends = {} / 2 }}`; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { unused };',
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
    assertEquals(typeof namespace.unused, "function");
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("masks comment quotes after division following a function expression", () => {
    const { masked } = __maskCommentQuotesForModuleLexer(
      `const ratio = function() {} / 2; import styles /* from "./decoy.module.css" */ from "./Button.module.css";`,
    );

    assertEquals(
      masked.includes('/* from "./decoy.module.css" */'),
      false,
      "division after a function expression must not leave css comment quotes unmasked",
    );
  });

  it("masks comment quotes after division following a class expression", () => {
    const { masked } = __maskCommentQuotesForModuleLexer(
      `const ratio = class {} / 2; import styles /* from "./decoy.module.css" */ from "./Button.module.css";`,
    );

    assertEquals(
      masked.includes('/* from "./decoy.module.css" */'),
      false,
      "division after a class expression must not leave css comment quotes unmasked",
    );
  });

  it("reopens regex context after standalone and labelled statement blocks", () => {
    for (
      const prefix of [
        `{} /[\"]/u.test(value);`,
        `outer: {} /[\"]/u.test(value);`,
      ]
    ) {
      const { masked } = __maskCommentQuotesForModuleLexer(
        `${prefix} import styles /* from "./decoy.module.css" */ from "./Button.module.css";`,
      );

      assertEquals(
        masked.includes('/* from "./decoy.module.css" */'),
        false,
        "a statement block closing brace must leave a following slash in regex context",
      );
    }
  });

  it("keeps `of` as an operand in a classic for initializer", () => {
    const { masked } = __maskCommentQuotesForModuleLexer(
      `const of = 4; for (let i = of / 2; i < 3; i++) {} import styles /* from "./decoy.module.css" */ from "./Button.module.css";`,
    );

    assertEquals(
      masked.includes('/* from "./decoy.module.css" */'),
      false,
      "an ordinary binding named of inside a classic for head must keep division semantics",
    );
  });

  it("decodes escaped await before classifying a for-await head", () => {
    const source = String
      .raw`async function consume() { for aw\u0061it (const value of /["]/u) { break; } } import styles /* from "./decoy.module.css" */ from "./Button.module.css";`;

    const { masked } = __maskCommentQuotesForModuleLexer(source);

    assertStringIncludes(
      masked,
      String.raw`for aw\u0061it (const value of /["]/u)`,
      "the regex slash in a for-await head must not be rewritten as division",
    );
    assertEquals(
      masked.includes(`/* from "./decoy.module.css" */`),
      false,
      "the scanner must still reach and mask quotes in the later import comment",
    );
  });

  it("retains declaration-body state through parameter object braces", () => {
    const { masked } = __maskCommentQuotesForModuleLexer(
      `function f(options = {}) {} /[\"]/u.test(value); import styles /* from "./decoy.module.css" */ from "./Button.module.css";`,
    );

    assertEquals(
      masked.includes('/* from "./decoy.module.css" */'),
      false,
      "an object in a parameter initializer must not consume the function declaration body",
    );
  });

  it("treats `...` as one operator so a spread operand may be a regex", async () => {
    const ctx = createContext(
      `const copy = { .../["]/u }; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export const k = Object.keys(copy).length;`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
    assertEquals(typeof namespace.k, "number");
  });

  it("keeps statement-block context inside a template interpolation", async () => {
    const ctx = createContext(
      'const value = \'"\'; const t = `${(() => { if (value) {} /["]/u.test(value); return 1; })()}`; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { t };',
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
    assertEquals(namespace.t, "1");
  });

  it("allows a regex literal as an unbraced `else` body", async () => {
    const ctx = createContext(
      `const value = '"'; let matched = false; if (!value) matched = true; else /["]/u.test(value); import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { matched };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.cls,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a regex after `else` must not trap the scanner in string mode",
    );
    assertEquals(namespace.matched, false);
  });

  it("allows a regex literal as an unbraced `do` body", async () => {
    const ctx = createContext(
      `const value = '"'; let seen = 0; do /["]/u.test(value), seen++; while (seen < 1); import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { seen };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.cls,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a regex after `do` must not trap the scanner in string mode",
    );
    assertEquals(namespace.seen, 1);
  });

  it("keeps member context for keyword-named properties before division", async () => {
    const ctx = createContext(
      `const stats = { return: 4 }; const value = stats.return / 2; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { value };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
    assertEquals(namespace.value, 2);
  });

  it("starts a regex after a control-flow condition while masking comments", async () => {
    const ctx = createContext(
      `const enabled = true; let observed = ""; const record = (value) => { observed = value; return value; }; if (enabled) /["]/u.test(record('"')); import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { observed };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.cls,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a regex literal used as an unbraced if body must not hide a later css import comment",
    );
    assertEquals(
      namespace.observed,
      '"',
      "the regex literal after the control-flow condition must stay executable",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("treats division after a call expression as division while masking comments", async () => {
    const ctx = createContext(
      `const size = (n) => n; const value = size(5) / 2; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export { value };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.cls,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a division slash after a call expression must not hide a later css import comment",
    );
    assertEquals(
      namespace.value,
      2.5,
      "a closing parenthesis that is not a control-flow head must keep division semantics",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("does not borrow a sentinel encoded by a Unicode escape", async () => {
    const ctx = createContext(
      `export { "\\uE000" } /* from "./decoy.module.css" */ from "./Button.module.css";`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace["\uE000"],
      toScopedCssModuleClass(MODULE_KEY, "\uE000"),
      "restoring comment quotes must not rewrite decoded export-name data",
    );
  });

  it("does not restore scanner markers inside generated export names", async () => {
    for (
      const { prefix, encodedName, decodedName } of [
        {
          prefix: "const ratio = function() {} / 2;",
          encodedName: "%\\u002f*__VF_CSS_DIVISION_0__*/",
          decodedName: "%/*__VF_CSS_DIVISION_0__*/",
        },
        {
          prefix: '{} /["]/u.test("\\"");',
          encodedName: "\\u003b__VF_CSS_REGEX_0__",
          decodedName: ";__VF_CSS_REGEX_0__",
        },
      ] as const
    ) {
      const ctx = createContext(
        `${prefix} export { "${encodedName}" } /* from "./decoy.module.css" */ from "./Button.module.css";`,
      );

      const result = await cssStripPlugin.transform(ctx);
      const namespace = await evaluateModule(result);

      assertEquals(
        namespace[decodedName],
        toScopedCssModuleClass(MODULE_KEY, decodedName),
        "restoring scanner masks must not rewrite decoded generated names",
      );
    }
  });

  it("restores many scanner markers in one transform pass", async () => {
    const regexStatements = Array.from(
      { length: 1_024 },
      (_, index) => `function declared${index}() {} /["]/u.test(value);`,
    ).join(" ");
    const ctx = createContext(
      `const value = '"'; ${regexStatements} import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container;`,
    );

    const result = await cssStripPlugin.transform(ctx);

    assertEquals(result.includes("./decoy.module.css"), false);
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("reserves a surrogate pair split by a string line continuation", async () => {
    // Exhaust the BMP private-use sentinels so selection reaches U+F0000, then
    // spell that code point as a continuation-split surrogate pair. The pair
    // decodes to one character at runtime, so it must be reserved.
    //
    // The emitted source is asserted directly rather than evaluated: the filler
    // makes the module too large for a `data:` URL under Bun.
    const bmpPrivateUse = Array.from(
      { length: 0xf8ff - 0xe000 + 1 },
      (_, offset) => String.fromCodePoint(0xe000 + offset),
    ).join("");
    const ctx = createContext(
      `const filler = ${
        JSON.stringify(bmpPrivateUse)
      }; export { "\\uDB80\\\n\\uDC00" } /* from "./decoy.module.css" */ from "./Button.module.css"; export { filler };`,
    );

    const result = await cssStripPlugin.transform(ctx);

    assertStringIncludes(
      result,
      `as "\u{F0000}"`,
      "a continuation-split surrogate pair must not be borrowed as a quote sentinel",
    );
  });

  it("reserves a surrogate pair written with braced escapes", async () => {
    const bmpPrivateUse = Array.from(
      { length: 0xf8ff - 0xe000 + 1 },
      (_, offset) => String.fromCodePoint(0xe000 + offset),
    ).join("");
    const ctx = createContext(
      `const filler = ${
        JSON.stringify(bmpPrivateUse)
      }; export { "\\u{DB80}\\u{DC00}" } /* from "./decoy.module.css" */ from "./Button.module.css"; export { filler };`,
    );

    const result = await cssStripPlugin.transform(ctx);

    assertStringIncludes(
      result,
      `as "\u{F0000}"`,
      "adjacent braced surrogate escapes must reserve their combined code point",
    );
  });

  it("reserves surrogate pairs split between source text and escapes", async () => {
    const bmpPrivateUse = Array.from(
      { length: 0xf8ff - 0xe000 + 1 },
      (_, offset) => String.fromCodePoint(0xe000 + offset),
    ).join("");
    const high = String.fromCharCode(0xdb80);
    const low = String.fromCharCode(0xdc00);

    for (
      const { exportName, label } of [
        {
          exportName: `${high}\\uDC00`,
          label: "literal high surrogate plus escaped low surrogate",
        },
        {
          exportName: `\\uDB80${low}`,
          label: "escaped high surrogate plus literal low surrogate",
        },
      ] as const
    ) {
      const ctx = createContext(
        `const filler = ${
          JSON.stringify(bmpPrivateUse)
        }; export { "${exportName}" } /* from "./decoy.module.css" */ from "./Button.module.css"; export { filler };`,
      );

      const result = await cssStripPlugin.transform(ctx);

      assertStringIncludes(
        result,
        `as "\u{F0000}"`,
        `${label} must not be borrowed as a quote sentinel`,
      );
      assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
    }
  });

  it("treats a leading hashbang as a line comment while masking comments", async () => {
    const ctx = createContext(
      `#!/usr/bin/env user's-runner\nimport styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container;`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(namespace.cls, toScopedCssModuleClass(MODULE_KEY, "container"));
  });

  it("preserves quoted css export names", async () => {
    const ctx = createContext(
      `export { "foo-bar" as fooBar } from "./Button.module.css";`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.fooBar,
      toScopedCssModuleClass(MODULE_KEY, "foo-bar"),
      "a quoted css export name must remain available through its local alias",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("preserves closing braces inside quoted css re-export names", async () => {
    const ctx = createContext(
      `export { "foo}bar" as className } from "./Button.module.css";`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.className,
      toScopedCssModuleClass(MODULE_KEY, "foo}bar"),
      "a quoted closing brace must remain data instead of ending the export clause",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("preserves closing braces inside quoted css import names", async () => {
    const ctx = createContext(
      `import { "foo}bar" as className } from "./Button.module.css"; export { className };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.className,
      toScopedCssModuleClass(MODULE_KEY, "foo}bar"),
      "a quoted closing brace must remain data instead of ending the import clause",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("preserves single-quoted css export names and escaped quotes", async () => {
    const ctx = createContext(
      String
        .raw`import { 'foo"bar' as doubleQuote, 'foo\'bar' as singleQuote } from "./Button.module.css"; export { doubleQuote, singleQuote };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.doubleQuote,
      toScopedCssModuleClass(MODULE_KEY, 'foo"bar'),
      "a single-quoted export name containing a double quote must keep its local alias",
    );
    assertEquals(
      namespace.singleQuote,
      toScopedCssModuleClass(MODULE_KEY, "foo'bar"),
      "an escaped quote in a single-quoted export name must be decoded once",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("preserves quoted aliases on css re-exports", async () => {
    const ctx = createContext(
      `export { default as "styles-map" } from "./Button.module.css";`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      (namespace["styles-map"] as Record<string, string>)?.container,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "an arbitrary quoted export alias must remain linkable under that exact name",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("preserves unaliased quoted names on css re-exports", async () => {
    const ctx = createContext(
      `export { "foo-bar" } from "./Button.module.css";`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace["foo-bar"],
      toScopedCssModuleClass(MODULE_KEY, "foo-bar"),
      "an unaliased arbitrary export name must remain linkable under that name",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("preserves quoted aliases on css namespace re-exports", async () => {
    const ctx = createContext(
      `export * as "styles-map" from "./Button.module.css";`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      (namespace["styles-map"] as Record<string, Record<string, string>>)?.default?.container,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "an arbitrary namespace export name must keep the CSS module namespace shape",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("allocates disjoint locals for identifier and encoded-looking export names", async () => {
    const ctx = createContext(
      `export { a as $61_2d_62, b as "a-b" } from "./Button.module.css";`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.$61_2d_62,
      toScopedCssModuleClass(MODULE_KEY, "a"),
      "an identifier export must retain its own generated local",
    );
    assertEquals(
      namespace["a-b"],
      toScopedCssModuleClass(MODULE_KEY, "b"),
      "a quoted export must not collide with an identifier that resembles its encoding",
    );
  });

  it("serializes decoded unscoped css binding names as valid string literals", async () => {
    const ctx = createContext(
      String
        .raw`import { "line\nbreak" as lineBreak, "slash\\name" as slashName } from "./theme.css"; export { lineBreak, slashName };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.lineBreak,
      "line\nbreak",
      "a decoded newline must remain data rather than becoming generated source syntax",
    );
    assertEquals(
      namespace.slashName,
      "slash\\name",
      "a decoded backslash must survive generated module serialization exactly once",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./theme.css"]);
  });

  it("escapes HTML raw-text delimiters in generated JavaScript strings", async () => {
    const ctx = createContext(
      `import { "</script>" as boundary } from "./theme.css"; export { boundary };`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(result.includes("</script>"), false);
    assertEquals(namespace.boundary, "</script>");
  });

  it("keeps generated comments parseable when css specifiers contain comment terminators", async () => {
    const ctx = createContext(
      `import "./theme*/x.css"; export const ok = true;`,
    );

    const result = await cssStripPlugin.transform(ctx);

    await assertParsesAsModule(
      result,
      "a css specifier must not be able to terminate the generated comment",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./theme*/x.css"]);
  });

  it("does not treat `from` inside a quoted css export name as the keyword", async () => {
    const ctx = createContext(
      `export { "foo-from" as fooFrom } from "./Button.module.css";`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.fooFrom,
      toScopedCssModuleClass(MODULE_KEY, "foo-from"),
      "a quoted export name containing `from` must remain available through its alias",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("resolves a named `default` css import to the class map, not the literal name", async () => {
    const ctx = createContext(
      `import { default as styles } from "./Button.module.css"; export const cls = styles.container;`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.cls,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      '`default` is the class map, so a named `default` import must not stub the string "default"',
    );
  });

  it("does not redeclare a source binding that already uses the generated local prefix", async () => {
    const ctx = createContext(
      `const __vfCssExport_styles = "own"; export { default as styles } from "./Button.module.css"; export const own = __vfCssExport_styles;`,
    );

    const result = await cssStripPlugin.transform(ctx);

    assertEquals(
      (result.match(/\bconst\s+__vfCssExport_styles\s*=/g) ?? []).length,
      1,
      "the module's own `__vfCssExport_styles` must stay the only declaration of that name",
    );
    const namespace = await evaluateModule(result);
    assertEquals(
      namespace.own,
      "own",
      "the module's own binding must keep its value rather than be shadowed by the stub",
    );
    assertEquals(
      (namespace.styles as Record<string, string>)?.container,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "the css re-export must still resolve through a collision-free local",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("allocates a css export local without rescanning a long prefix-like string", async () => {
    const decoy = `__vfCssExport_${"$".repeat(10_000)}`;
    const ctx = createContext(
      `export const decoy = ${
        JSON.stringify(decoy)
      }; export { default as styles } from "./Button.module.css";`,
    );

    const result = await cssStripPlugin.transform(ctx);

    assertStringIncludes(
      result,
      "const __vfCssExport_0 =",
      "a long prefix-like string must not force repeated source scans or alter allocation",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("strips comments from a css re-export binding clause", async () => {
    const ctx = createContext(
      `export { default /* from "./decoy.module.css" */ as styles } from "./Button.module.css";`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      (namespace.styles as Record<string, string>).container,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a comment inside a re-export clause must not drop the re-exported binding",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("ends a css import line comment at every ECMAScript line terminator", async () => {
    for (
      const [name, terminator] of [
        ["CR", "\r"],
        ["LS", "\u2028"],
        ["PS", "\u2029"],
        ["LF", "\n"],
      ] as const
    ) {
      const ctx = createContext(
        `import styles // decoy${terminator} from "./Button.module.css";\nexport const cls = styles.container;`,
      );

      const result = await cssStripPlugin.transform(ctx);
      const namespace = await evaluateModule(result);

      assertEquals(
        namespace.cls,
        toScopedCssModuleClass(MODULE_KEY, "container"),
        `a line comment closed by ${name} must not swallow the css import clause`,
      );
      assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
    }
  });

  it("treats an escaped identifier as occupying the generated css export local", async () => {
    const ctx = createContext(
      `const __vfCssExport_\\u0030 = "own"; export { default as styles } from "./Button.module.css"; export const own = __vfCssExport_\\u0030;`,
    );

    const result = await cssStripPlugin.transform(ctx);
    const namespace = await evaluateModule(result);

    assertEquals(
      namespace.own,
      "own",
      "an escaped spelling of the generated local must not be redeclared by the stub",
    );
    assertEquals(
      (namespace.styles as Record<string, string>).container,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "the re-export stub must still carry the css binding",
    );
  });

  it("masks comment quotes even when the bmp private use area is exhausted", async () => {
    let pua = "";
    for (let codePoint = 0xe000; codePoint <= 0xf8ff; codePoint++) {
      pua += String.fromCodePoint(codePoint);
    }
    const puaLiteral = JSON.stringify(pua);
    const ctx = createContext(
      `const icons = ${puaLiteral}; import styles /* from "./decoy.module.css" */ from "./Button.module.css"; export const cls = styles.container; export const iconCount = [...icons].length;`,
    );

    const result = await cssStripPlugin.transform(ctx);
    assertStringIncludes(
      result,
      puaLiteral,
      "restoring the mask must leave every private use character intact",
    );
    // Bun rejects data-URL module specifiers of this size. Shrink only the
    // already-verified fixture literal so every runtime can still link and
    // evaluate the generated CSS stub.
    const namespace = await evaluateModule(result.replace(puaLiteral, '"x"'));

    assertEquals(
      namespace.cls,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "masking must survive a module occupying every bmp private use code point",
    );
    assertEquals(
      namespace.iconCount,
      1,
      "the compacted module must remain executable after masking",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("fails closed when every comment mask sentinel is occupied", () => {
    const occupiedSentinels = allPrivateUseSentinelCandidates();

    const error = assertThrows(
      () =>
        __maskCommentQuotesForModuleLexer(
          `const occupied = ${
            JSON.stringify(occupiedSentinels)
          }; import styles /* from "./decoy.module.css" */ from "./Button.module.css";`,
        ),
      Error,
      "CSS import comment masking could not allocate sentinels",
    );

    const errorSlug = error && typeof error === "object" && "slug" in error
      ? error.slug
      : undefined;
    assertEquals(errorSlug, "css-comment-mask-sentinel-exhausted");
  });

  it("does not allocate comment-mask sentinels for a module without css", async () => {
    const code = `const suffix = ".css"; const occupied = ${
      JSON.stringify(allPrivateUseSentinelCandidates())
    };`;
    const ctx = createContext(code);

    const result = await cssStripPlugin.transform(ctx);

    assertEquals(result, code);
    assertEquals(ctx.metadata.has("cssImports"), false);
  });

  it("strips a star css re-export, which carries no static names", async () => {
    const ctx = createContext(`export * from "./globals.css";`);

    const result = await cssStripPlugin.transform(ctx);

    assertStringIncludes(
      result,
      "css re-export stripped",
      "a star css re-export has no static names to stub and must be stripped",
    );
    assertEquals(
      result.includes(`"./globals.css"`),
      false,
      "no live .css specifier may survive",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./globals.css"]);
  });

  it("keeps dynamic non-css imports untouched", async () => {
    const code = `async function load(){ return await import("./feature.js"); }`;
    const ctx = createContext(code);

    const result = await cssStripPlugin.transform(ctx);

    assertEquals(result, code);
    assertEquals(ctx.metadata.has("cssImports"), false);
  });
});

/**
 * The production ordering: `compilePlugin` runs with `minify: !ctx.dev`
 * immediately before this stage, so the statements the stub generator sees in a
 * production build are whatever esbuild emits, not the spaced source form.
 */
describe("css-strip after a production compile", () => {
  afterAll(async () => {
    await stopEsbuild();
  });

  it("keeps css re-exports linkable through the minified compile output", async () => {
    const source = `export { default as styles, container as root } from "./Button.module.css";
export * as ns from "./Button.module.css";
`;
    const compileCtx = createContext(source, false);
    const compiled = await compilePlugin.transform(compileCtx);

    const stripCtx = createContext(compiled, false);
    const result = await cssStripPlugin.transform(stripCtx);

    assertEquals(
      result.includes('.module.css"'),
      false,
      "no live .module.css specifier may survive a production build",
    );
    const namespace = await evaluateModule(result);
    assertEquals(
      (namespace.styles as Record<string, string>)?.container,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a production css re-export must still resolve to the scoped class map",
    );
    assertEquals(
      namespace.root,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a production named css re-export must still resolve to its scoped class",
    );
    assertEquals(
      (namespace.ns as Record<string, Record<string, string>>)?.default?.container,
      toScopedCssModuleClass(MODULE_KEY, "container"),
      "a production css namespace re-export must keep its module-namespace shape",
    );
  });
});
