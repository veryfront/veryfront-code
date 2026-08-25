import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  generateTokenCSS,
  UI_SCOPE_ALIAS_ATTRIBUTE,
  UI_SCOPE_ATTRIBUTE,
  UI_SCOPE_SELECTOR,
} from "./design-tokens.ts";

/**
 * Split the generated sheet at the dark media query. `assertStringIncludes` over
 * the whole string only proves a value appears SOMEWHERE, which stays green if
 * the light and dark palettes are swapped; every colour assertion below names
 * the mode it belongs to instead.
 */
function splitByColorMode(): { light: string; dark: string } {
  const css = generateTokenCSS();
  const darkIndex = css.indexOf("@media(prefers-color-scheme:dark)");
  assert(darkIndex > 0, "the dark media query follows the light rule");
  return { light: css.slice(0, darkIndex), dark: css.slice(darkIndex) };
}

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

  it("keeps light alert fills and provides dark-mode alert surfaces", () => {
    const { light, dark } = splitByColorMode();

    for (
      const [variant, hex] of Object.entries({
        warning: "#F1E3CD",
        error: "#ECD3D1",
        success: "#D4E2D2",
        info: "#E6E6E0",
      })
    ) {
      assertStringIncludes(
        light,
        `--alert-${variant}-bg:${hex}`,
        `the hex ${variant} alert fill belongs to the light rule`,
      );
      assert(
        !light.includes(`--alert-${variant}-bg:color-mix`),
        `the light rule must not carry the dark-mode ${variant} alert fill`,
      );
      assertStringIncludes(
        dark,
        `--alert-${variant}-bg:color-mix(in oklch,var(--status-${variant}) 18%,var(--background))`,
        `the color-mix ${variant} alert fill belongs to the dark rules`,
      );
    }
  });

  it("ships a border token for every alert fill, in both color modes", () => {
    const { light, dark } = splitByColorMode();

    // `Alert` resolves `border-[var(--alert-*-border)]`. A fill without its
    // border token would leave the border color invalid and fall back to
    // currentColor, so the pairs must stay in lockstep - and each value must
    // land in the color mode it was authored for.
    for (
      const [variant, hex] of Object.entries({
        warning: "#F5BA67",
        error: "#E06E7B",
        success: "#6FB57C",
        info: "#ADADAA",
      })
    ) {
      assertStringIncludes(
        light,
        `--alert-${variant}-border:${hex}`,
        `the hex ${variant} alert border belongs to the light rule`,
      );
      assert(
        !light.includes(`--alert-${variant}-border:color-mix`),
        `the light rule must not carry the dark-mode ${variant} alert border`,
      );
      assertStringIncludes(
        dark,
        `--alert-${variant}-border:color-mix(in oklch,var(--status-${variant}) 40%,var(--background))`,
        `the color-mix ${variant} alert border belongs to the dark rules`,
      );
    }
  });
});
