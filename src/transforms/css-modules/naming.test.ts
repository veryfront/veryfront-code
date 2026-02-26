import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  normalizeCssModuleKey,
  resolveCssModuleKey,
  rewriteCssModuleContent,
  toScopedCssModuleClass,
} from "./naming.ts";

describe("css-modules/naming", () => {
  it("resolves relative and alias module keys deterministically", () => {
    const relative = resolveCssModuleKey(
      "./Button.module.css",
      "/project/pages/home/index.tsx",
      "/project",
    );
    const alias = resolveCssModuleKey(
      "@/styles/Button.module.css",
      "/project/pages/index.tsx",
      "/project",
    );

    assertEquals(relative, "/project/pages/home/Button.module.css");
    assertEquals(alias, "/project/styles/Button.module.css");
  });

  it("generates stable scoped class names", () => {
    const key = "/project/components/Button.module.css";
    const first = toScopedCssModuleClass(key, "container");
    const second = toScopedCssModuleClass(key, "container");
    const different = toScopedCssModuleClass(key, "header");

    assertEquals(first, second);
    assertEquals(first === different, false);
    assertEquals(first.startsWith("Button_container__"), true);
  });

  it("rewrites module selectors and preserves :global()", () => {
    const key = normalizeCssModuleKey("/project/components/Button.module.css");
    const css = `
.container { color: red; }
:global(.prose) .container { margin: 0; }
`;

    const rewritten = rewriteCssModuleContent(css, key);

    assertEquals(rewritten.includes(".Button_container__"), true);
    assertEquals(rewritten.includes(":global(.prose)"), true);
  });

  it("rewrites compound selectors like .a.b", () => {
    const key = normalizeCssModuleKey("/project/components/Card.module.css");
    const css = `.container.active { color: red; }`;

    const rewritten = rewriteCssModuleContent(css, key);

    assertEquals(rewritten.includes(".Card_container__"), true);
    assertEquals(rewritten.includes(".Card_active__"), true);
    // Original unsoped class names should not remain
    assertEquals(rewritten.includes(".container"), false);
    assertEquals(rewritten.includes(".active {"), false);
  });
});
