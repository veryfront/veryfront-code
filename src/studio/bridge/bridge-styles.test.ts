import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createOverlayStyleElement,
  hasOverlayStyleElement,
  normalizeStyleInjectionWarningContext,
  OVERLAY_STYLE_ELEMENT_ID,
} from "./bridge-style-helpers.ts";

describe("studio/bridge/bridge-style-helpers", () => {
  it("detects when the overlay styles are already present", () => {
    assertEquals(
      hasOverlayStyleElement({
        getElementById(id: string) {
          return id === OVERLAY_STYLE_ELEMENT_ID ? {} as HTMLElement : null;
        },
      }),
      true,
    );

    assertEquals(
      hasOverlayStyleElement({
        getElementById() {
          return null;
        },
      }),
      false,
    );
  });

  it("creates a style element with the expected id and css", () => {
    const style = createOverlayStyleElement({
      createElement(tagName: string) {
        return { tagName: tagName.toUpperCase(), id: "", textContent: "" } as HTMLStyleElement;
      },
      getElementById() {
        return null;
      },
    }, ".vf-overlay { display: block; }");

    assertEquals(style.id, OVERLAY_STYLE_ELEMENT_ID);
    assertEquals(style.textContent, ".vf-overlay { display: block; }");
    assertEquals(style.tagName, "STYLE");
  });

  it("preserves Error instances for logger context", () => {
    const error = new Error("blocked");
    assertStrictEquals(normalizeStyleInjectionWarningContext(error), error);
  });

  it("normalizes unknown errors into loggable objects", () => {
    assertEquals(normalizeStyleInjectionWarningContext("blocked"), { error: "blocked" });
  });
});
