import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  generateTokenCSS,
  UI_SCOPE_ALIAS_ATTRIBUTE,
  UI_SCOPE_ATTRIBUTE,
  UI_SCOPE_SELECTOR,
} from "./design-tokens.ts";

// The token scope migration is dual-scope: `[data-vf-ui]` is canonical, and
// `[data-vf-chat]` stays a working compat alias. These tests lock in that every
// generated rule matches BOTH scopes so no existing consumer breaks.
describe("design-tokens dual scope", () => {
  it("exposes the canonical + alias attributes and a combined selector", () => {
    assertEquals(UI_SCOPE_ATTRIBUTE, "data-vf-ui");
    assertEquals(UI_SCOPE_ALIAS_ATTRIBUTE, "data-vf-chat");
    // Canonical first — the order portal `closest()` lookups prefer.
    assertEquals(UI_SCOPE_SELECTOR, "[data-vf-ui],[data-vf-chat]");
  });

  it("scopes every token rule to both [data-vf-ui] and [data-vf-chat]", () => {
    const css = generateTokenCSS();

    // Base token rule matches both scopes...
    assertStringIncludes(css, "[data-vf-ui],[data-vf-chat]{font-family:");
    // ...as does the button-cursor rule...
    assertStringIncludes(css, "[data-vf-ui] button,[data-vf-chat] button{cursor:pointer;}");
    // ...and the dark-mode paths (media query + class/data-theme selectors).
    assertStringIncludes(
      css,
      "@media(prefers-color-scheme:dark){[data-vf-ui]:not([data-vf-theme]),[data-vf-chat]:not([data-vf-theme]){",
    );
    assertStringIncludes(css, ".dark [data-vf-ui]:not([data-vf-theme])");
    assertStringIncludes(css, ".dark [data-vf-chat]:not([data-vf-theme])");

    // Tokens never leak to :root (host tokens must win).
    assert(!css.includes(":root{"), "design tokens must stay scoped, never on :root");
  });

  it("keeps dark tokens gated behind :not([data-vf-theme]) for both scopes", () => {
    const css = generateTokenCSS();
    // A surface that pins its own theme via [data-vf-theme] opts out of the
    // ambient dark rules — true for the alias scope too.
    assertStringIncludes(css, '[data-theme="dark"][data-vf-chat]:not([data-vf-theme])');
    assertStringIncludes(css, '[data-theme="dark"][data-vf-ui]:not([data-vf-theme])');
  });
});
