import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { TransformContext } from "../types.ts";
import { cssStripPlugin } from "./ssr-css-strip.ts";
import {
  getCssModuleScope,
  resolveCssModuleKey,
  rewriteCssModuleContent,
  toScopedCssModuleClass,
} from "#veryfront/transforms/css-modules/naming.ts";

const MODULE_KEY = resolveCssModuleKey(
  "./Button.module.css",
  "/project/pages/index.tsx",
  "/project",
);

function createContext(code: string): TransformContext {
  return {
    code,
    originalSource: code,
    filePath: "/project/pages/index.tsx",
    projectDir: "/project",
    projectId: "project",
    target: "ssr",
    dev: true,
    contentHash: "hash",
    jsxImportSource: "react",
    timing: new Map(),
    debug: false,
    metadata: new Map(),
    reactVersion: "19.1.1",
  } as TransformContext;
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

  it("strips a css re-export without turning it into a local const", async () => {
    const ctx = createContext(
      `export { default as styles } from "./Button.module.css";`,
    );

    const result = await cssStripPlugin.transform(ctx);

    assertStringIncludes(
      result,
      "css re-export stripped",
      "a css re-export must be replaced by the re-export comment",
    );
    assertEquals(
      /\bconst\s+styles\s*=/.test(result),
      false,
      "a css re-export must not degrade into a non-exported const binding",
    );
    assertEquals(
      result.includes(`.module.css"`),
      false,
      "no live .module.css specifier may survive",
    );
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("keeps dynamic non-css imports untouched", async () => {
    const code = `async function load(){ return await import("./feature.js"); }`;
    const ctx = createContext(code);

    const result = await cssStripPlugin.transform(ctx);

    assertEquals(result, code);
    assertEquals(ctx.metadata.has("cssImports"), false);
  });
});
