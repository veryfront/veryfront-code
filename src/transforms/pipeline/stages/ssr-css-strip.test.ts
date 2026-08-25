import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { stop as stopEsbuild } from "#veryfront/platform/compat/esbuild.ts";
import { compilePlugin } from "./compile.ts";
import type { TransformContext } from "../types.ts";
import { cssStripPlugin } from "./ssr-css-strip.ts";
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
