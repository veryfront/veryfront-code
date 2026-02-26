import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { TransformContext } from "../types.ts";
import { cssStripPlugin } from "./ssr-css-strip.ts";

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
    assertStringIncludes(
      result,
      'await Promise.resolve({ default: new Proxy({}, { get: (_, p) => typeof p === "string" ? "Button_"',
    );
    assertStringIncludes(result, "__");
    assertEquals(ctx.metadata.get("cssImports"), ["./Button.module.css"]);
  });

  it("rewrites static css module imports to scoped class names", async () => {
    const ctx = createContext(
      `import styles, { container as root } from "./Button.module.css"; export const c = styles.container + " " + root;`,
    );

    const result = await cssStripPlugin.transform(ctx);

    assertEquals(result.includes(`import styles`), false);
    assertStringIncludes(result, "const styles = new Proxy({},");
    assertStringIncludes(result, "const styles = new Proxy({},");
    assertStringIncludes(result, 'root = "Button_container__');
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
